import { loadWorkerConfig, safeError, WorkerRuntime } from '../src/worker-runtime.js';

try {
const config = loadWorkerConfig(process.cwd());
const runtime = await WorkerRuntime.create(config);
console.log(JSON.stringify({ event: 'worker_starting', deployment: config.deploymentFile, sourceRegistry: config.sourceRegistry, sourceStartBlock: config.sourceStartBlock, automaticClaim: config.autoClaim }));
let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ event: 'worker_stopping', signal }));
  await runtime.stop();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
await runtime.start();
} catch (error) {
  console.error(JSON.stringify({ event: 'worker_failed', error: safeError(error) }));
  process.exit(1);
}
