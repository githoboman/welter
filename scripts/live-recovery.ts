import fs from 'node:fs';
import path from 'node:path';
import { Contract, JsonRpcProvider, Wallet, keccak256, parseEther } from 'ethers';
import { loadDeploymentManifest, roleKey } from '../src/deployment.js';

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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const { manifest, file: deploymentFile } = loadDeploymentManifest(root);
if (manifest.protocolVersion !== 'post-fix-v2') throw new Error(`recovery demo requires post-fix-v2 deployment (${deploymentFile})`);
const provider = new JsonRpcProvider(env('CREDITCOIN_RPC_URL'));
const network = await provider.getNetwork();
if (Number(network.chainId) !== manifest.destination.chainId) throw new Error('CC3 RPC network does not match deployment manifest');
const organizer = new Wallet(roleKey('organizer')!, provider);
const trigger = new Wallet(roleKey('payout_trigger')!, provider);
const token = new Contract(manifest.destination.token.address, artifact('MockPrizeToken').abi, organizer);
const vault = new Contract(manifest.destination.vault.address, artifact('PrizeVault').abi, organizer);
const vaultAsTrigger = new Contract(manifest.destination.vault.address, artifact('PrizeVault').abi, trigger);
const amount = parseEther('1');
const tournamentId = keccak256(Buffer.from(`post-fix-recovery-${Date.now()}`));
const now = Math.floor(Date.now() / 1000);
const settlementDeadline = now + 45;
const refundDeadline = now + 90;
const organizerAddress = await organizer.getAddress();
await (await token.mint(organizerAddress, amount)).wait();
await (await vault.createTournament(tournamentId, organizerAddress, manifest.source.chainKey, manifest.source.contract, manifest.source.rulesHash, manifest.destination.token.address, amount, settlementDeadline, refundDeadline)).wait();
await (await token.approve(manifest.destination.vault.address, amount)).wait();
await (await vault.fund(tournamentId)).wait();
const fundedBalance = BigInt((await token.balanceOf(manifest.destination.vault.address)).toString());
await sleep(Math.max(0, (refundDeadline - Math.floor(Date.now() / 1000) + 5) * 1000));
const before = BigInt((await token.balanceOf(organizerAddress)).toString());
const recoveryTx = await vaultAsTrigger.recoverExpired(tournamentId);
const recoveryReceipt = await recoveryTx.wait();
const policy = await vault.policies(tournamentId);
const after = BigInt((await token.balanceOf(organizerAddress)).toString());
let settlementBlockedByState = false;
try {
  const vaultRead = new Contract(manifest.destination.vault.address, artifact('PrizeVault').abi, provider);
  await vaultRead.settle.staticCall(tournamentId, organizerAddress, 1, keccak256(Buffer.from('recovery-query')), { from: manifest.destination.asc.address });
} catch {
  settlementBlockedByState = true;
}
if (Number(policy.state) !== 4 || after - before !== amount || fundedBalance !== amount || !settlementBlockedByState) throw new Error('expired recovery invariants failed');
const evidence = {
  mode: 'live-recovery',
  protocolVersion: manifest.protocolVersion,
  deployment: { manifest: path.relative(root, deploymentFile) },
  tournamentId,
  deadlines: { settlementDeadline, refundDeadline },
  organizer: organizerAddress,
  trigger: await trigger.getAddress(),
  funding: { amount: amount.toString(), vaultBalanceBeforeRecovery: fundedBalance.toString() },
  recovery: { hash: recoveryTx.hash, blockNumber: recoveryReceipt.blockNumber, gasUsed: recoveryReceipt.gasUsed.toString(), state: Number(policy.state), organizerBalanceIncrease: (after - before).toString() },
  settlementBlockedByState,
  explorers: { recovery: `https://creditcoin-testnet.blockscout.com/tx/${recoveryTx.hash}` },
};
fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
const file = path.join(root, 'evidence', `recovery-${tournamentId.slice(2, 10)}.json`);
fs.writeFileSync(file, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ file: path.relative(root, file), ...evidence }, null, 2));
