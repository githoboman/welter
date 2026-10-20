import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);
const required = ['live-2026-09-10T02-44-30-530Z.json', 'recovery-f620cf7d.json', 'post-fix-deployment-2026-09-10T02-43-34-178Z.json'];

test('static build includes only reviewed assets and rejects missing or secret-bearing evidence', { timeout: 60_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-packaging-'));
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.mkdir(path.join(root, 'evidence'));
  await fs.cp('frontend/src', path.join(root, 'frontend/src'), { recursive: true });
  for (const name of ['index.html', 'styles.css']) await fs.copyFile(`frontend/${name}`, path.join(root, 'frontend', name));
  await fs.copyFile('scripts/frontend-build.mjs', path.join(root, 'scripts/frontend-build.mjs'));
  await fs.symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), 'dir');
  for (const name of required.slice(1)) await fs.copyFile(`evidence/${name}`, path.join(root, 'evidence', name));
  const build = () => exec(process.execPath, ['scripts/frontend-build.mjs'], {
    cwd: root, env: { ...process.env, WORKER_PRIVATE_KEY: 'PRIVATE_BUILD_SENTINEL_DO_NOT_EXPOSE' },
  });
  await assert.rejects(build(), /required public evidence is missing/);
  await fs.copyFile(`evidence/${required[0]}`, path.join(root, 'evidence', required[0]));
  await build();
  assert.deepEqual((await fs.readdir(path.join(root, 'frontend/public/evidence'))).sort(), [...required].sort());
  assert.ok(!(await fs.readFile(path.join(root, 'frontend/public/dist/app.js'), 'utf8')).includes('PRIVATE_BUILD_SENTINEL_DO_NOT_EXPOSE'));
  await fs.writeFile(path.join(root, 'evidence', required[0]), JSON.stringify({ WORKER_PRIVATE_KEY: 'private-placeholder' }));
  await assert.rejects(build(), /public evidence failed the browser-safety check/);
  console.log(`Local-only packaging fixture: ${root}`);
});
