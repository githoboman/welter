import fs from 'node:fs';
import path from 'node:path';
import { Contract, JsonRpcProvider, Wallet, keccak256, parseEther, AbiCoder } from 'ethers';
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
function artifact(name: string) { return JSON.parse(fs.readFileSync(path.join(root, 'artifacts', `${name}.json`), 'utf8')); }
async function send(contract: Contract, method: string, args: unknown[]) {
  const response = await (contract as any)[method](...args);
  const receipt = await response.wait();
  return { hash: response.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() };
}

const sourceRpc = env('SEPOLIA_RPC_URL');
const destinationRpc = env('CREDITCOIN_RPC_URL');
const finalizerKey = roleKey('finalizer')!;
const organizerKey = roleKey('organizer')!;
const playerOneKey = roleKey('player_one')!;
const playerTwoKey = roleKey('player_two')!;
const workerKey = roleKey('worker')!;
const payoutTriggerKey = roleKey('payout_trigger')!;
const sourceProvider = new JsonRpcProvider(sourceRpc);
const destinationProvider = new JsonRpcProvider(destinationRpc);
const finalizer = new Wallet(finalizerKey, sourceProvider);
const organizer = new Wallet(organizerKey, destinationProvider);
const playerOne = new Wallet(playerOneKey, sourceProvider);
const playerTwo = new Wallet(playerTwoKey, sourceProvider);
const worker = new Wallet(workerKey, destinationProvider);
const payoutTrigger = new Wallet(payoutTriggerKey, destinationProvider);

const { manifest, file: deploymentFile } = loadDeploymentManifest(root);
if (manifest.protocolVersion !== 'post-fix-v2') throw new Error(`live E2E requires a post-fix-v2 deployment manifest (${deploymentFile})`);
if (manifest.source.chainId !== 11155111 || manifest.destination.chainId !== 102031) throw new Error('deployment manifest has unexpected network IDs');
const [sourceNetwork, destinationNetwork] = await Promise.all([sourceProvider.getNetwork(), destinationProvider.getNetwork()]);
if (Number(sourceNetwork.chainId) !== manifest.source.chainId || Number(destinationNetwork.chainId) !== manifest.destination.chainId) throw new Error('RPC network does not match deployment manifest');
const registryAddress = manifest.source.contract;
const tokenAddress = manifest.destination.token.address;
const vaultAddress = manifest.destination.vault.address;
const ascAddress = manifest.destination.asc.address;
const registry = new Contract(registryAddress, artifact('TournamentResultRegistry').abi, finalizer);
const token = new Contract(tokenAddress, artifact('MockPrizeToken').abi, organizer);
const vault = new Contract(vaultAddress, artifact('PrizeVault').abi, organizer);
const asc = new Contract(ascAddress, artifact('PrizeRailASC').abi, worker);
assertAddress('source finalizer', await registry.finalizer(), finalizer.address);

const abi = AbiCoder.defaultAbiCoder();
const runId = `live-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const tournamentId = keccak256(Buffer.from(`${runId}-tournament`));
const matchId = keccak256(Buffer.from(`${runId}-match`));
const rulesHash = keccak256(Buffer.from('prizerail-rps-v1'));
const amount = parseEther('1');
const sourceBlock = await sourceProvider.getBlock('latest');
const revealDeadline = Number(sourceBlock?.timestamp ?? Math.floor(Date.now() / 1000)) + 1800;
const settlementDeadline = Math.floor(Date.now() / 1000) + 3600;
const refundDeadline = settlementDeadline + 3600;
const organizerAddress = await organizer.getAddress();
const playerOneAddress = await playerOne.getAddress();
const playerTwoAddress = await playerTwo.getAddress();

const funding = [];
funding.push(await send(token, 'mint', [organizerAddress, amount]));
funding.push(await send(vault, 'createTournament', [tournamentId, organizerAddress, 1, registryAddress, rulesHash, tokenAddress, amount, settlementDeadline, refundDeadline]));
funding.push(await send(token, 'approve', [vaultAddress, amount]));
funding.push(await send(vault, 'fund', [tournamentId]));

const sourceSteps = [];
sourceSteps.push(await send(registry, 'createMatch', [tournamentId, matchId, playerOneAddress, playerTwoAddress, rulesHash, revealDeadline]));
const saltOne = keccak256(Buffer.from(`${runId}-one`));
const saltTwo = keccak256(Buffer.from(`${runId}-two`));
const commit = (choice: number, salt: string) => keccak256(abi.encode(['uint8', 'bytes32'], [choice, salt]));
sourceSteps.push(await send(new Contract(registryAddress, artifact('TournamentResultRegistry').abi, playerOne), 'commit', [matchId, commit(1, saltOne)]));
sourceSteps.push(await send(new Contract(registryAddress, artifact('TournamentResultRegistry').abi, playerTwo), 'commit', [matchId, commit(3, saltTwo)]));
sourceSteps.push(await send(new Contract(registryAddress, artifact('TournamentResultRegistry').abi, playerOne), 'reveal', [matchId, 1, saltOne]));
sourceSteps.push(await send(new Contract(registryAddress, artifact('TournamentResultRegistry').abi, playerTwo), 'reveal', [matchId, 3, saltTwo]));
const finalized = await send(registry, 'finalize', [matchId]);
const finalizedReceipt = await sourceProvider.getTransactionReceipt(finalized.hash);
if (!finalizedReceipt || finalizedReceipt.status !== 1) throw new Error('finalization receipt was not successful');
const decoded = rpsMatchFinalizedAdapter.decode(finalizedReceipt, registryAddress);
const sourceResult = await registry.matches(matchId);
if (decoded.winner.toLowerCase() !== playerOneAddress.toLowerCase() || sourceResult.winner.toLowerCase() !== playerOneAddress.toLowerCase()) throw new Error('source result winner was not player one');

const attestationStartedAt = Date.now();
const proofResult = await getAttestcoinProof(sourceRpc, destinationRpc, env('ATTESTCOIN_PROVER_URL'), finalized.hash, 1);
const attestationLatencyMs = Date.now() - attestationStartedAt;
if (!proofResult.verified) throw new Error('Attestcoin precompile rejected the generated proof');
const query = proofToQuery(proofResult.proof);
const settlement = await send(asc, 'verifyAndSettle', [0, query.chainKey, query.blockHeight, query.encodedTransaction, query.merkleRoot, query.siblings, query.lowerEndpointDigest, query.continuityRoots, { gasLimit: 3_000_000 }]);
const claim = await send(new Contract(vaultAddress, artifact('PrizeVault').abi, payoutTrigger), 'claimFor', [tournamentId]);
let replayResponse: any = null;
let replay: any = { rejected: false };
try {
  replayResponse = await (asc as any).verifyAndSettle(0, query.chainKey, query.blockHeight, query.encodedTransaction, query.merkleRoot, query.siblings, query.lowerEndpointDigest, query.continuityRoots, { gasLimit: 3_000_000 });
  const receipt = await replayResponse.wait();
  replay = { rejected: receipt.status === 0, hash: replayResponse.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), status: receipt.status };
} catch (error) {
  const receipt = (error as any).receipt;
  replay = {
    rejected: true,
    hash: replayResponse?.hash ?? receipt?.hash ?? null,
    blockNumber: receipt?.blockNumber ?? null,
    gasUsed: receipt?.gasUsed?.toString() ?? null,
    status: receipt?.status ?? 0,
    error: safeError(error),
  };
}
if (!replay.rejected || !replay.hash || replay.status !== 0) throw new Error('live replay was not recorded as a mined status-0 transaction');

const policy = await vault.policies(tournamentId);
const winnerBalance = await token.balanceOf(decoded.winner);
const finalizedSourceBlock = await sourceProvider.getBlock(finalized.blockNumber);
const settlementBlock = await destinationProvider.getBlock(settlement.blockNumber);

const evidence = {
  runId: `live-${tournamentId.slice(2, 10)}`,
  mode: 'live-attestcoin',
  deployment: { manifest: path.relative(root, deploymentFile), protocolVersion: manifest.protocolVersion },
  source: { chainId: 11155111, chainKey: 1, registry: registryAddress, transaction: finalized, decoded, steps: sourceSteps },
  destination: { chainId: 102031, token: tokenAddress, vault: vaultAddress, asc: ascAddress, amount: amount.toString(), funding, settlement, payout: claim, finalState: Number(policy.state), winnerBalance: winnerBalance.toString() },
  attestation: { proofIdentifier: keccak256(query.encodedTransaction), proofCached: proofResult.proof.cached ?? null, headerNumber: proofResult.proof.headerNumber, verified: proofResult.verified, latencyMs: attestationLatencyMs },
  replay,
  timing: { sourceBlockTimestamp: finalizedSourceBlock?.timestamp ?? null, settlementBlockTimestamp: settlementBlock?.timestamp ?? null, sourceToSettlementSeconds: finalizedSourceBlock && settlementBlock ? Number(settlementBlock.timestamp) - Number(finalizedSourceBlock.timestamp) : null },
  explorers: { source: `https://sepolia.etherscan.io/tx/${finalized.hash}`, settlement: `https://creditcoin-testnet.blockscout.com/tx/${settlement.hash}`, payout: `https://creditcoin-testnet.blockscout.com/tx/${claim.hash}`, replay: `https://creditcoin-testnet.blockscout.com/tx/${replay.hash}` },
  wallets: { deploymentSigner: manifest.destination.deployer, finalizer: finalizer.address, organizer: organizerAddress, playerOne: playerOneAddress, playerTwo: playerTwoAddress, winner: decoded.winner, worker: worker.address, payoutTrigger: payoutTrigger.address },
};
fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
fs.writeFileSync(path.join(root, 'evidence', `${runId}.json`), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
