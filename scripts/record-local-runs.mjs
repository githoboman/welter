import { spawn } from 'node:child_process';
import fs from 'node:fs';

const root = process.cwd();
const records = [];
for (let i = 1; i <= 3; i += 1) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/local-e2e.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`run ${i} failed (${code}): ${stderr || stdout}`));
      try { records.push(JSON.parse(stdout)); resolve(); } catch (error) { reject(error); }
    });
  });
}
const lines = [
  '# PrizeRail E2E Run Log',
  '',
  '> These are reproducible local Anvil runs using a verifier double installed at the documented `0x0FD2` address. They prove contract/state behavior only. They are not the required live Sepolia-to-CC3 Attestcoin milestone.',
  '',
  `Recorded: ${new Date().toISOString()}`,
  '',
  '| Run ID | Source tx | Settlement tx | Payout tx | Replay | Gas (source / settle / payout) |',
  '|---|---|---|---|---|---|',
];
for (const [index, run] of records.entries()) lines.push(`| local-${index + 1} | ${run.source.hash} (block ${run.source.blockNumber}) | ${run.settlement.hash} (block ${run.settlement.blockNumber}) | ${run.payout.hash} (block ${run.payout.blockNumber}) | rejected | ${run.source.gasUsed} / ${run.settlement.gasUsed} / ${run.payout.gasUsed} |`);
lines.push('', '## Negative-path evidence', '', 'Each run rejects wrong chain, source registry, event signature, tournament ID, rules hash, winner, nonce, finalization state, invalid proof, unfunded policy, source/business replay, double payout, expired result, and unauthorized settlement/refund. Full machine-readable evidence is overwritten at `evidence/local-e2e-run-1.json` for the last run; rerun the command to reproduce any individual record.');
fs.writeFileSync('research/LOCAL-E2E-RUN-LOG.md', `${lines.join('\n')}\n`);
console.log(JSON.stringify({ runs: records.length, log: 'research/LOCAL-E2E-RUN-LOG.md' }));
