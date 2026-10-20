import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Filesystem audit only: an inventory is not a substitute for a Git diff.
const exec = promisify(execFile);
const files = (await exec('rg', ['--files', '--hidden', '--no-require-git', '-g', '!.git/**', '-g', '!.agents/**', '-g', '!.codex/**'], { maxBuffer: 10_000_000 })).stdout
  .trim().split('\n').filter(Boolean).sort();
const envText = await fs.readFile('.env', 'utf8').catch(() => '');
const knownSecrets = [];
for (const line of envText.split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (!match) continue;
  const value = match[2].trim().replace(/^['"]|['"]$/g, '');
  if (/PRIVATE_KEY|SECRET|PASSWORD|MNEMONIC|TOKEN|API_KEY/.test(match[1]) && value.length >= 12 && !/YOUR_|PLACEHOLDER/.test(value)) {
    knownSecrets.push(value, value.replace(/^0x/, ''));
  }
  if (/_URL$/.test(match[1])) {
    try {
      const url = new URL(value);
      for (const secret of [url.password, ...url.searchParams.values()]) if (secret.length >= 12) knownSecrets.push(secret);
    } catch { /* Non-URL configuration is checked by the application. */ }
  }
}
const snapshot = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-publication-scan-'));
const findings = [];
const suspiciousNames = [];
for (const file of files) {
  if (/(?:^|\/)(?:\.env(?!\.example$)|.*\.(?:db|sqlite|journal|log)$|\.vercel|\.render)(?:\/|$)/i.test(file)) suspiciousNames.push(file);
  const stat = await fs.lstat(file);
  if (!stat.isFile()) { findings.push({ file, rule: 'non-regular-file' }); continue; }
  const content = await fs.readFile(file, 'utf8');
  if (knownSecrets.some((secret) => content.includes(secret))) findings.push({ file, rule: 'local-secret-value' });
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) findings.push({ file, rule: 'pem-private-key' });
  await fs.mkdir(path.dirname(path.join(snapshot, file)), { recursive: true });
  await fs.copyFile(file, path.join(snapshot, file));
}
const publicFiles = (await exec('rg', ['--files', '--no-ignore', 'frontend/public'])).stdout.trim().split('\n').filter(Boolean);
for (const file of publicFiles) {
  const content = await fs.readFile(file, 'utf8');
  if (knownSecrets.some((secret) => content.includes(secret))) findings.push({ file, rule: 'browser-local-secret-value' });
}
console.log(JSON.stringify({ outcome: findings.length || suspiciousNames.length ? 'FAIL' : 'PASS', scope: 'filesystem candidates and known local secret values; no Git history available', snapshot, files, browserFiles: publicFiles.sort(), findings, suspiciousNames }, null, 2));
if (findings.length || suspiciousNames.length) process.exitCode = 1;
