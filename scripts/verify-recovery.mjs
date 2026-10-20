import fs from 'node:fs';
import path from 'node:path';
import { Contract, Interface, JsonRpcProvider } from 'ethers';
import { safeError } from './safe-error.mjs';

const root = process.cwd();
const evidencePath = process.argv[2] ?? 'evidence/recovery-f620cf7d.json';
const evidence = JSON.parse(fs.readFileSync(path.resolve(root, evidencePath), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.resolve(root, evidence.deployment.manifest), 'utf8'));
const provider = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL || 'https://rpc.cc3-testnet.creditcoin.network', 102031, { staticNetwork: true });
const vaultAbi = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'PrizeVault.json'), 'utf8')).abi;
const tokenAbi = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'MockPrizeToken.json'), 'utf8')).abi;
const vaultInterface = new Interface(vaultAbi);
const checks = [];
const add = (name, status, detail) => checks.push({ name, status, detail });
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
try {
  const network = await provider.getNetwork();
  add('destination chain ID', Number(network.chainId) === 102031 ? 'PASS' : 'FAIL', String(network.chainId));
  const receipt = await provider.getTransactionReceipt(evidence.recovery.hash);
  if (!receipt) add('recovery receipt', 'UNKNOWN', 'receipt unavailable');
  else {
    add('recovery receipt status/target', receipt.status === 1 && same(receipt.to, manifest.destination.vault.address) ? 'PASS' : 'FAIL', `status=${receipt.status} to=${receipt.to}`);
    const recovered = receipt.logs.map((log) => { try { return { parsed: vaultInterface.parseLog(log), address: log.address }; } catch { return null; } }).find((entry) => entry?.parsed?.name === 'TournamentRecovered' && same(entry.address, manifest.destination.vault.address))?.parsed;
    add('TournamentRecovered event', recovered && same(recovered.args.tournamentId, evidence.tournamentId) && same(recovered.args.organizer, evidence.organizer) && BigInt(recovered.args.amount) === BigInt(evidence.funding.amount) ? 'PASS' : 'FAIL', recovered ? `organizer=${recovered.args.organizer} amount=${recovered.args.amount}` : 'missing');
    const token = new Contract(manifest.destination.token.address, tokenAbi, provider);
    try {
      const [organizerBefore, organizerAfter, vaultBefore, vaultAfter] = await Promise.all([
        token.balanceOf(evidence.organizer, { blockTag: receipt.blockNumber - 1 }),
        token.balanceOf(evidence.organizer, { blockTag: receipt.blockNumber }),
        token.balanceOf(manifest.destination.vault.address, { blockTag: receipt.blockNumber - 1 }),
        token.balanceOf(manifest.destination.vault.address, { blockTag: receipt.blockNumber }),
      ]);
      const amount = BigInt(evidence.funding.amount);
      add('organizer historical balance increase', organizerAfter - organizerBefore === amount ? 'PASS' : 'FAIL', `before=${organizerBefore} after=${organizerAfter}`);
      add('vault historical balance decrease', vaultBefore - vaultAfter === amount ? 'PASS' : 'FAIL', `before=${vaultBefore} after=${vaultAfter}`);
    } catch (error) {
      add('historical token balances', 'UNKNOWN', `public RPC archive read unavailable: ${safeError(error)}`);
    }
  }
  const vault = new Contract(manifest.destination.vault.address, vaultAbi, provider);
  const policy = await vault.policies(evidence.tournamentId);
  add('terminal policy state', Number(policy.state) === 4 ? 'PASS' : 'FAIL', `state=${policy.state}`);
  add('immutable organizer beneficiary', same(policy.organizer, evidence.organizer) ? 'PASS' : 'FAIL', policy.organizer);
  add('recorded recovery amount', BigInt(policy.amount) === BigInt(evidence.funding.amount) && BigInt(evidence.recovery.organizerBalanceIncrease) === BigInt(policy.amount) ? 'PASS' : 'FAIL', String(policy.amount));
  const authority = await vault.settlementAuthority();
  add('settlement authority binding', same(authority, manifest.destination.asc.address) ? 'PASS' : 'FAIL', authority);
  try {
    await provider.call({ to: manifest.destination.vault.address, from: manifest.destination.asc.address, data: vaultInterface.encodeFunctionData('settle', [evidence.tournamentId, evidence.organizer, 1, `0x${'01'.padStart(64, '0')}`]) });
    add('settlement blocked after recovery', 'FAIL', 'settle simulation unexpectedly succeeded');
  } catch (error) {
    const data = error?.data ?? error?.info?.error?.data ?? '';
    const expected = vaultInterface.getError('InvalidState')?.selector;
    add('settlement blocked after recovery', String(data).startsWith(expected) ? 'PASS' : 'UNKNOWN', `revert=${String(data).slice(0, 10) || 'unavailable'}`);
  }
} catch (error) {
  add('public recovery verification', 'UNKNOWN', safeError(error));
}
provider.destroy();
const overall = checks.some((item) => item.status === 'FAIL') ? 'FAIL' : checks.some((item) => item.status === 'UNKNOWN') ? 'UNKNOWN' : 'PASS';
console.log(JSON.stringify({ evidence: evidencePath, writesPerformed: false, checks, overall }, null, 2));
process.exit(overall === 'FAIL' ? 1 : 0);
