import { createConfigurationFailureServer, PrizeRailApi } from '../src/api.js';
import { loadWorkerConfig, safeError, WorkerRuntime } from '../src/worker-runtime.js';

async function listenFailure(error: unknown): Promise<void> {
  const message = safeError(error);
  console.error(JSON.stringify({ event: 'api_configuration_failed', error: message }));
  const server = createConfigurationFailureServer(error);
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve()); });
  process.once('SIGINT', () => server.close(() => process.exit(0)));
  process.once('SIGTERM', () => server.close(() => process.exit(0)));
}

function attachShutdown(server: import('node:http').Server): void {
  const shutdown = (signal: string) => {
    console.log(JSON.stringify({ event: 'api_stopping', signal }));
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

try {
  const config = loadWorkerConfig(process.cwd());
  const runtime = await WorkerRuntime.create(config);
  const api = new PrizeRailApi(runtime, config);
  const server = await api.listen();
  attachShutdown(server);

  // Bind the HTTP port before network/prover validation. Render can therefore
  // reach /api/v1/health and receive UNKNOWN during an outage instead of
  // treating a slow dependency as an unavailable API process.
  void runtime.validateConfiguration().then((validation) => {
    console.log(JSON.stringify({ event: 'api_configuration_validated', outcome: validation.outcome }));
  }).catch((error) => {
    console.error(JSON.stringify({ event: 'api_configuration_validation_failed', error: safeError(error) }));
  });
} catch (error) {
  await listenFailure(error);
}
