import fs from 'node:fs';
import path from 'node:path';
import { Contract, JsonRpcProvider, Wallet, keccak256 } from 'ethers';
import { getAttestcoinProof } from '../src/attestcoin.js';
import { proofToQuery, rpsMatchFinalizedAdapter } from '../src/adapter.js';
import { assertAddress, loadDeploymentManifest, roleKey } from '../src/deployment.js';
import { safeError } from '../src/worker-runtime.js';

const root = process.cwd();
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\n/)) {
  const match = line.replace(/\r$/, '').match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}
const env = (name: string) => {
  const value = process.env[name]?.replace(/\r$/, '');
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const artifact = (name: string) => JSON.parse(fs.readFileSync(path.join(root, 'artifacts', `${name}.json`), 'utf8'));
const txHash = process.argv[2];
if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? '')) throw new Error('usage: npm run live:complete -- <MatchFinalized tx hash>');

const sourceProvider = new JsonRpcProvider(env('SEPOLIA_RPC_URL'));
const cc3Provider = new JsonRpcProvider(env('CREDITCOIN_RPC_URL'));
const worker = new Wallet(roleKey('worker')!, cc3Provider);
const payoutTrigger = new Wallet(roleKey('payout_trigger')!, cc3Provider);
const { manifest, file: deploymentFile } = loadDeploymentManifest(root);
if (manifest.protocolVersion !== 'post-fix-v2') throw new Error(`live completion requires a post-fix-v2 deployment manifest (${deploymentFile})`);
const [sourceNetwork, destinationNetwork] = await Promise.all([sourceProvider.getNetwork(), cc3Provider.getNetwork()]);
if (Number(sourceNetwork.chainId) !== manifest.source.chainId || Number(destinationNetwork.chainId) !== manifest.destination.chainId) throw new Error('RPC network does not match deployment manifest');
const registryAddress = manifest.source.contract;
const tokenAddress = manifest.destination.token.address;
const vaultAddress = manifest.destination.vault.address;
const ascAddress = manifest.destination.asc.address;
const sourceReceipt = await sourceProvider.getTransactionReceipt(txHash);
if (!sourceReceipt || sourceReceipt.status !== 1) throw new Error('source transaction is not a successful receipt');
const decoded = rpsMatchFinalizedAdapter.decode(sourceReceipt, registryAddress);
const tournamentId = decoded.tournamentId;
const matchId = decoded.matchId;

const proofStartedAt = Date.now();
const proof = await getAttestcoinProof(env('SEPOLIA_RPC_URL'), env('CREDITCOIN_RPC_URL'), env('ATTESTCOIN_PROVER_URL'), txHash, 1);
const proofRetrievalLatencyMs = Date.now() - proofStartedAt;
if (!proof.verified) throw new Error('Attestcoin precompile preflight returned false');
const query = proofToQuery(proof.proof);
const sourceQueryKey = keccak256(query.encodedTransaction);
const vault = new Contract(vaultAddress, artifact('PrizeVault').abi, worker);
const asc = new Contract(ascAddress, artifact('PrizeRailASC').abi, worker);
assertAddress('source finalizer deployment binding', await new Contract(registryAddress, artifact('TournamentResultRegistry').abi, sourceProvider).finalizer(), manifest.source.finalizer ?? manifest.source.deployer);

let policy = await vault.policies(tournamentId);
let settlement: any = null;
if (Number(policy.state) === 1) {
  const response = await asc.verifyAndSettle(0, query.chainKey, query.blockHeight, query.encodedTransaction, query.merkleRoot, query.siblings, query.lowerEndpointDigest, query.continuityRoots, { gasLimit: 3_000_000 });
  const receipt = await response.wait();
  settlement = { hash: response.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() };
  policy = await vault.policies(tournamentId);
} else {
  const filter = asc.filters.ResultVerified(tournamentId);
  const logs = await asc.queryFilter(filter, 5_459_000, 'latest');
  const log = logs.at(-1);
  if (log) {
    const receipt = await log.getTransactionReceipt();
    settlement = { hash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), recovered: true };
  }
}
if (Number(policy.state) !== 2 && Number(policy.state) !== 3) throw new Error(`policy not claimable/claimed after settlement: ${policy.state}`);

let payout: any = null;
if (Number(policy.state) === 2) {
  const response = await new Contract(vaultAddress, artifact('PrizeVault').abi, payoutTrigger).claimFor(tournamentId, { gasLimit: 500_000 });
  const receipt = await response.wait();
  payout = { hash: response.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() };
  policy = await vault.policies(tournamentId);
} else {
  const logs = await vault.queryFilter(vault.filters.PrizeClaimed(tournamentId), 5_459_000, 'latest');
  const log = logs.at(-1);
  if (log) {
    const receipt = await log.getTransactionReceipt();
    payout = { hash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), recovered: true };
  }
}
if (Number(policy.state) !== 3) throw new Error(`policy not claimed after payout: ${policy.state}`);

let replayResponse: any = null;
let replay: any = { rejected: false };
try {
  replayResponse = await asc.verifyAndSettle(0, query.chainKey, query.blockHeight, query.encodedTransaction, query.merkleRoot, query.siblings, query.lowerEndpointDigest, query.continuityRoots, { gasLimit: 3_000_000 });
  const receipt = await replayResponse.wait();
  replay = { rejected: receipt.status === 0, hash: replayResponse.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), status: receipt.status };
} catch (error) {
  const receipt = (error as any).receipt;
  replay = { rejected: true, hash: replayResponse?.hash ?? receipt?.hash ?? null, blockNumber: receipt?.blockNumber ?? null, gasUsed: receipt?.gasUsed?.toString() ?? null, status: receipt?.status ?? 0, error: safeError(error) };
}
if (!replay.rejected) throw new Error('replay unexpectedly succeeded');

const sourceBlock = await sourceProvider.getBlock(sourceReceipt.blockNumber);
const settlementBlock = settlement ? await cc3Provider.getBlock(settlement.blockNumber) : null;
const token = new Contract(tokenAddress, artifact('MockPrizeToken').abi, cc3Provider);
const winnerBalance = await token.balanceOf(decoded.winner);
const evidence = {
  runId: `live-${tournamentId.slice(2, 10)}`,
  mode: 'live-attestcoin',
  deployment: { manifest: path.relative(root, deploymentFile), protocolVersion: manifest.protocolVersion },
  source: { chainId: 11155111, chainKey: 1, registry: registryAddress, transaction: { hash: txHash, blockNumber: sourceReceipt.blockNumber, gasUsed: sourceReceipt.gasUsed.toString() }, decoded },
  attestation: { proofIdentifier: sourceQueryKey, headerNumber: proof.proof.headerNumber, cached: proof.proof.cached ?? null, verified: proof.verified, proofRetrievalLatencyMs },
  destination: { chainId: 102031, token: tokenAddress, vault: vaultAddress, asc: ascAddress, amount: policy.amount.toString(), settlement, payout, finalState: Number(policy.state), winnerBalance: winnerBalance.toString() },
  replay,
  timing: { sourceBlockTimestamp: sourceBlock?.timestamp ?? null, settlementBlockTimestamp: settlementBlock?.timestamp ?? null, sourceToSettlementSeconds: sourceBlock && settlementBlock ? Number(settlementBlock.timestamp) - Number(sourceBlock.timestamp) : null },
  explorers: { source: `https://sepolia.etherscan.io/tx/${txHash}`, settlement: settlement ? `https://creditcoin-testnet.blockscout.com/tx/${settlement.hash}` : null, payout: payout ? `https://creditcoin-testnet.blockscout.com/tx/${payout.hash}` : null, replay: replay.hash ? `https://creditcoin-testnet.blockscout.com/tx/${replay.hash}` : null },
};
fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
fs.writeFileSync(path.join(root, 'evidence', `${evidence.runId}.json`), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
