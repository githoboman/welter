import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DurableStore } from '../src/durable-store.js';

// Infrastructure test only: every RPC/prover request targets an unused loopback
// port. This key is a public test scalar and cannot reach any blockchain here.
const localEnv = {
  ...process.env,
  HOST: '0.0.0.0', PORT: '0',
  SEPOLIA_RPC_URL: 'http://127.0.0.1:1',
  CREDITCOIN_RPC_URL: 'http://127.0.0.1:1',
  ATTESTCOIN_PROVER_URL: 'http://127.0.0.1:1',
  WORKER_PRIVATE_KEY: `0x${'0'.repeat(63)}1`,
  WORKER_AUTO_CLAIM: 'false', WORKER_POLL_INTERVAL_MS: '100',
  PRIZERAIL_DEPLOYMENT_MANIFEST: 'evidence/current-deployment.json',
};

function service(directory: string, overrides = {}) {
  const child = spawn(process.execPath, ['scripts/start-render.mjs'], {
    env: { ...localEnv, PRIZERAIL_DATA_DIR: directory, ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  return { child, exited, logs: () => logs };
}

async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeout = 45_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('local service condition timed out');
}

async function portOf(instance: ReturnType<typeof service>) {
  const logs = await until(async () => instance.logs(), (value) => /"event":"api_started"/.test(value));
  assert.match(logs, /"host":"0.0.0.0"/);
  return Number(logs.match(/"event":"api_started"[^\n]*"port":(\d+)/)?.[1]);
}

test('combined service survives restart, exposes UNKNOWN health, and forwards parent-only SIGTERM', { timeout: 120_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-render-test-'));
  const store = await DurableStore.open(directory, 100);
  await store.setCursor({ schemaVersion: 1, nextBlock: 12345678, lastScannedBlock: 12345677, updatedAt: new Date().toISOString() });
  let instance: ReturnType<typeof service> | undefined;
  try {
    let previousOwner: string | undefined;
    for (let run = 0; run < 2; run++) {
      instance = service(directory);
      const port = await portOf(instance);
      const live = await fetch(`http://127.0.0.1:${port}/api/v1/live`);
      assert.equal(live.status, 200);
      assert.equal((await live.json() as any).scope, 'API_PROCESS_ONLY');
      const owner = await until(async () => {
        await store.refresh();
        return store.getWorkerHeartbeat()?.owner;
      }, (value) => Boolean(value && value !== previousOwner));
      assert.equal(store.getCursor().nextBlock, 12345678);
      const health = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(15_000) });
      assert.equal(health.status, 503);
      const body = await health.json() as any;
      assert.equal(body.outcome, 'UNKNOWN');
      assert.equal(body.dependencies.persistence.outcome, 'PASS');
      assert.equal(body.dependencies.workerLoop.outcome, 'PASS');
      instance.child.kill('SIGTERM');
      assert.equal(await instance.exited, 0);
      assert.match(instance.logs(), /\[api\].*api_stopping/);
      assert.match(instance.logs(), /\[worker\].*worker_stopping/);
      previousOwner = owner;
    }
    assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(directory, 'worker.journal'))).mode & 0o777, 0o600);
  } finally {
    if (instance && instance.child.exitCode === null) { instance.child.kill('SIGTERM'); await instance.exited; }
    if (instance) console.log(instance.logs());
    // Temporary test state is retained for inspection; never touch .data/.
    console.log(`Local-only persistence fixture: ${directory}`);
  }
});

test('critical worker startup failure terminates API and returns nonzero', { timeout: 60_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-render-failure-'));
  const instance = service(directory, { PRIZERAIL_DEPLOYMENT_MANIFEST: path.join(directory, 'missing.json') });
  try {
    assert.equal(await instance.exited, 1);
    assert.match(instance.logs(), /\[render\] worker exited with code 1/);
    assert.match(instance.logs(), /\[render\] api exited/);
  } finally {
    if (instance.child.exitCode === null) { instance.child.kill('SIGTERM'); await instance.exited; }
    console.log(instance.logs());
  }
});

test('unexpected clean worker exit is a service failure', { timeout: 60_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-render-child-exit-'));
  const instance = service(directory);
  try {
    await portOf(instance);
    await until(async () => instance.logs(), (value) => value.includes('worker_starting'));
    const workerPid = Number(instance.logs().match(/worker started pid (\d+)/)?.[1]);
    assert.ok(workerPid > 0);
    // Signal only the worker; the supervisor must treat even code 0 as unexpected.
    process.kill(workerPid, 'SIGINT');
    assert.equal(await instance.exited, 1);
    assert.match(instance.logs(), /worker exited with code 0/);
    assert.match(instance.logs(), /api exited.*during shutdown/);
  } finally {
    if (instance.child.exitCode === null) { instance.child.kill('SIGTERM'); await instance.exited; }
    console.log(instance.logs());
  }
});
