import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shutdownTimeoutMs = 10_000;
let shuttingDown = false;
let exitCode = 0;

const children = new Map();
let finish;
const finished = new Promise((resolve) => { finish = resolve; });

function prefixOutput(label, stream, output, streamName) {
  const reader = createInterface({ input: stream });
  reader.on('line', (line) => output.write(`[${label}] ${line}\n`));
  reader.on('close', () => output.write(`[${label}] <${streamName} closed>\n`));
}

function spawnChild(label, script) {
  const child = spawn(process.execPath, ['--import', 'tsx', `scripts/${script}`], {
    cwd: root,
    env: {
      ...process.env,
      // Render's public listener must be reachable on the platform-provided
      // port. Local npm run api keeps its loopback default when used alone.
      HOST: process.env.HOST?.trim() || '0.0.0.0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.set(label, child);
  child.once('spawn', () => console.log(`[render] ${label} started pid ${child.pid}`));
  prefixOutput(label, child.stdout, process.stdout, 'stdout');
  prefixOutput(label, child.stderr, process.stderr, 'stderr');
  child.once('error', (error) => {
    console.error(`[render] ${label} process error: ${error.message}`);
    if (!shuttingDown) void shutdown(1);
  });
  child.once('exit', (code, signal) => {
    const expected = shuttingDown;
    const status = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
    console.log(`[render] ${label} exited with ${status}${expected ? ' during shutdown' : ''}`);
    if (!expected) {
      exitCode = code && code > 0 ? code : 1;
      void shutdown(exitCode);
    }
  });
  return child;
}

function waitForExit(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('close', resolve));
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  console.log(`[render] stopping API and worker (exit ${exitCode})`);
  for (const child of children.values()) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  const wait = Promise.all([...children.values()].map(waitForExit));
  let timeout;
  await Promise.race([
    wait,
    new Promise((resolve) => { timeout = setTimeout(resolve, shutdownTimeoutMs); }),
  ]);
  clearTimeout(timeout);
  for (const child of children.values()) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      console.error('[render] child exceeded shutdown deadline; forcing termination');
      exitCode = 1;
      child.kill('SIGKILL');
    }
  }
  await wait;
  process.exitCode = exitCode;
  finish();
}

// A supervisor receiving the platform's termination signal is a normal
// lifecycle event. Unexpected child exits still choose a nonzero code above.
process.once('SIGINT', () => { void shutdown(0); });
process.once('SIGTERM', () => { void shutdown(0); });

console.log('[render] starting API and worker in one service instance');
spawnChild('api', 'api.ts');
spawnChild('worker', 'worker.ts');

await finished;
