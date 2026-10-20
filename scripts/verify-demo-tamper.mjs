import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const evidencePath = process.argv[2] ?? 'evidence/live-2026-09-10T02-44-30-530Z.json';
const original = JSON.parse(fs.readFileSync(path.resolve(root, evidencePath), 'utf8'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'prizerail-tamper-'));
const oldSourceTx = '0x7f2de354984d134aa7c46f87fc7149839e8c2b5d17c048cb688333e1548bd0af';
const oldRegistry = '0x83Dfc7fbbd949441Cdc7f8b1eD2D916d059e764D';
const oldVault = '0x802c21a0093a9516D2FD26406F3e16b0E0D1e6F2';
const otherAddress = '0x00000000000000000000000000000000000000a1';
const cases = [
  ['wrong source transaction hash', 'FAIL', (e) => { e.source.transaction.hash = oldSourceTx; }],
  ['wrong registry address', 'FAIL', (e) => { e.source.registry = oldRegistry; }],
  ['wrong tournament ID', 'FAIL', (e) => { e.source.decoded.tournamentId = `0x${'11'.repeat(32)}`; }],
  ['wrong winner', 'FAIL', (e) => { e.source.decoded.winner = otherAddress; }],
  ['wrong amount', 'FAIL', (e) => { e.destination.amount = '2'; }],
  ['wrong settlement transaction', 'FAIL', (e) => { e.destination.settlement.hash = original.destination.payout.hash; }],
  ['wrong payout transaction', 'FAIL', (e) => { e.destination.payout.hash = original.destination.settlement.hash; }],
  ['wrong replay transaction', 'FAIL', (e) => { e.replay.hash = original.destination.settlement.hash; }],
  ['wrong deployment address', 'FAIL', (e) => { e.destination.vault = oldVault; }],
  ['unavailable source RPC', 'UNKNOWN', () => {}, { SEPOLIA_RPC_URL: 'http://127.0.0.1:1' }],
  ['unavailable destination RPC', 'UNKNOWN', () => {}, { CREDITCOIN_RPC_URL: 'http://127.0.0.1:1' }],
];

function run(file, overrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/verify-demo.mjs', file], { cwd: root, env: { ...process.env, VERIFY_DEMO_STOP_ON_FAIL: '1', VERIFY_DEMO_RPC_TIMEOUT_MS: '20000', ...overrides } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (value) => { stdout += value; });
    child.stderr.on('data', (value) => { stderr += value; });
    child.on('error', reject);
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 90_000);
    child.on('close', (status, signal) => {
      clearTimeout(killTimer);
      try { resolve(JSON.parse(stdout)); } catch {
        resolve({ overall: 'UNKNOWN', checks: [{ name: 'tamper verifier process', status: 'UNKNOWN', detail: `verifier process ended without JSON (status=${status} signal=${signal})` }] });
      }
    });
  });
}

try {
  const results = [];
  for (const [index, [name, expected, mutate, overrides = {}]] of cases.entries()) {
    const evidence = structuredClone(original);
    mutate(evidence);
    const file = path.join(temp, `${index}.json`);
    fs.writeFileSync(file, JSON.stringify(evidence));
    const output = await run(file, overrides);
    if (output.overall !== expected) throw new Error(`${name}: expected ${expected}, got ${output.overall}`);
    results.push({ name, expected, actual: output.overall });
  }
  console.log(JSON.stringify({ evidence: evidencePath, results, overall: 'PASS' }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
