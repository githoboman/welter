import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { DurableStore } from '../src/durable-store.js';
import { PrizeRailApi } from '../src/api.js';
import { RPS_MATCH_FINALIZED_SIGNATURE } from '../src/adapter.js';
import type { WorkerConfig } from '../src/worker-runtime.js';
import type { WorkerJob } from '../src/worker-types.js';

const ALLOWED_ORIGIN = 'http://localhost:4173';
const JOB_ID = `job-${'a'.repeat(24)}`;
const TOURNAMENT_ID = `0x${'3'.repeat(64)}`;
const SOURCE_HASH = `0x${'1'.repeat(64)}`;
const RULES_HASH = `0x${'7'.repeat(64)}`;

function apiConfig(dataDirectory: string): WorkerConfig {
  return {
    root: process.cwd(),
    sourceRpc: 'http://127.0.0.1:1',
    destinationRpc: 'http://127.0.0.1:1',
    proverUrl: 'http://127.0.0.1:1',
    sourceChainId: 11155111,
    destinationChainId: 102031,
    sourceChainKey: 1,
    sourceRegistry: `0x${'2'.repeat(40)}`,
    sourceFinalizer: `0x${'5'.repeat(40)}`,
    sourceDeploymentBlock: 1,
    sourceStartBlock: 1,
    destinationDeploymentBlock: 1,
    token: `0x${'8'.repeat(40)}`,
    vault: `0x${'9'.repeat(40)}`,
    asc: `0x${'a'.repeat(40)}`,
    expectedBlockProver: `0x${'b'.repeat(40)}`,
    expectedChainInfo: `0x${'c'.repeat(40)}`,
    workerPrivateKey: undefined,
    autoClaim: false,
    confirmations: 1,
    batchSize: 10,
    pollIntervalMs: 100,
    maxAttempts: 2,
    leaseTtlMs: 1_000,
    reorgRewind: 1,
    dataDirectory,
    sourceExplorer: 'https://sepolia.example.test',
    destinationExplorer: 'https://cc3.example.test',
    deploymentFile: 'evidence/current-deployment.json',
    manifest: {
      protocolVersion: 'post-fix-v2',
      source: {
        chainId: 11155111,
        chainKey: 1,
        contract: `0x${'2'.repeat(40)}`,
        deployer: `0x${'5'.repeat(40)}`,
        rulesHash: RULES_HASH,
      },
      destination: {
        chainId: 102031,
        deployer: `0x${'5'.repeat(40)}`,
        token: { address: `0x${'8'.repeat(40)}`, deploymentBlock: 1 },
        vault: { address: `0x${'9'.repeat(40)}`, deploymentBlock: 1 },
        asc: { address: `0x${'a'.repeat(40)}`, deploymentBlock: 1 },
        expectedBlockProver: `0x${'b'.repeat(40)}`,
        expectedChainInfo: `0x${'c'.repeat(40)}`,
      },
    },
  } as WorkerConfig;
}

function fixtureJob(now: string): WorkerJob {
  return {
    schemaVersion: 1,
    jobId: JOB_ID,
    sourceChainId: 11155111,
    sourceChainKey: 1,
    sourceTransactionHash: SOURCE_HASH,
    sourceBlockNumber: 10,
    sourceBlockHash: `0x${'d'.repeat(64)}`,
    sourceGas: '21000',
    sourceTimestamp: now,
    sourceRegistry: `0x${'2'.repeat(40)}`,
    sourceEventSignature: RPS_MATCH_FINALIZED_SIGNATURE,
    tournamentId: TOURNAMENT_ID,
    matchId: `0x${'4'.repeat(64)}`,
    playerOne: `0x${'5'.repeat(40)}`,
    playerTwo: `0x${'6'.repeat(40)}`,
    winner: `0x${'5'.repeat(40)}`,
    result: 1,
    rulesHash: RULES_HASH,
    resultNonce: '42',
    finalizationStatus: 0,
    sourceDeadline: '4102444800',
    sourceFinalizedAt: '1700000000',
    sourceReceiptStatus: 1,
    state: 'AWAITING_ATTESTATION',
    productState: 'AWAITING_ATTESTATION',
    dataMode: 'LIVE',
    outcome: 'UNKNOWN',
    evidenceOutcome: 'UNKNOWN',
    attemptCount: 1,
    retryCount: 0,
    nextRetryAt: null,
    lease: null,
    createdAt: now,
    updatedAt: now,
    proofStatus: 'PENDING',
    proofHeader: 10,
    proofDigest: `0x${'e'.repeat(64)}`,
    proofCached: false,
    proofLatencyMs: 120,
    proofPreflightOutcome: 'UNKNOWN',
    settlementTransactionHash: null,
    settlementReceiptStatus: null,
    settlementBlock: null,
    settlementGas: null,
    settlementTimestamp: null,
    payoutTransactionHash: null,
    payoutReceiptStatus: null,
    payoutBlock: null,
    payoutGas: null,
    payoutTimestamp: null,
    replayEvidence: null,
    refundRecoveryEvidence: null,
    policyState: 1,
    policy: null,
    resultVerified: null,
    tournamentSettled: null,
    prizeClaimed: null,
    explorerLinks: {
      source: `https://sepolia.example.test/tx/${SOURCE_HASH}`,
      settlement: null,
      payout: null,
      replay: null,
      recovery: null,
    },
    lastErrorClass: 'UNKNOWN',
    lastErrorMessage: 'PRIVATE_KEY=do-not-leak endpoint=http://127.0.0.1:8545 path=/home/unify/creditcoin/.env',
    evidenceReferences: [
      'evidence/http-transport-fixture.json',
      '../.env',
      'evidence/../.env',
      'https://attacker.invalid/proof.json',
    ],
  };
}

function policy(config: WorkerConfig): Record<string, string | number> {
  return {
    organizer: `0x${'4'.repeat(40)}`,
    sourceChainKey: config.sourceChainKey,
    sourceRegistry: config.sourceRegistry,
    rulesHash: RULES_HASH,
    token: config.token,
    amount: '1000000000000000000',
    settlementDeadline: 4102444800,
    refundDeadline: 4102448400,
    winner: `0x${'5'.repeat(40)}`,
    resultNonce: '0',
    sourceQueryKey: `0x${'0'.repeat(64)}`,
    state: 1,
  };
}

function close(server: import('node:http').Server): Promise<void> {
  return new Promise((resolve, reject) => {
    // Native fetch may leave an idle keep-alive socket in the agent pool. Drain
    // it before waiting for the server's close callback so the test cannot
    // retain a live handle after its assertions complete.
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    server.close((error) => error ? reject(error) : resolve());
  });
}

test('PrizeRailApi serves journal-backed projections over a real HTTP socket', async () => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-api-http-'));
  const previousOrigins = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = ALLOWED_ORIGIN;
  let server: import('node:http').Server | undefined;
  try {
    const config = apiConfig(dataDirectory);
    const store = await DurableStore.open(dataDirectory, config.sourceStartBlock);
    await store.saveJob(fixtureJob(new Date().toISOString()), 'HTTP transport fixture');
    const runtime = {
      config,
      store,
      getConfigurationCheck: () => ({ outcome: 'PASS' as const }),
      health: async () => ({
        api: { outcome: 'PASS' as const },
        configuration: { outcome: 'PASS' as const },
        persistence: { outcome: 'PASS' as const },
        sourceRpc: { outcome: 'PASS' as const },
        sourceDiscovery: { outcome: 'PASS' as const },
        destinationRpc: { outcome: 'PASS' as const },
        chainInfo: { outcome: 'PASS' as const },
        proofService: { outcome: 'PASS' as const },
        workerLoop: { outcome: 'PASS' as const, running: true, lastLoopAt: new Date().toISOString() },
      }),
      vault: { policies: async () => policy(config) },
      destinationProvider: { getBlock: async () => ({ timestamp: 1700000000 }) },
    };
    const api = new PrizeRailApi(runtime as any, config);
    server = await api.listen(0, '127.0.0.1');
    const address = server.address() as AddressInfo;
    assert.ok(address && typeof address.port === 'number' && address.port > 0);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const request = async (pathname: string, init: RequestInit = {}) => {
      const response = await fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers: { Origin: ALLOWED_ORIGIN, Connection: 'close', ...(init.headers ?? {}) },
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) as Record<string, any> : null;
      return { response, body, text };
    };

    const live = await request('/api/v1/live');
    assert.equal(live.response.status, 200);
    assert.deepEqual(live.body, { schemaVersion: 1, scope: 'API_PROCESS_ONLY', outcome: 'PASS' });
    const health = await request('/api/v1/health');
    assert.equal(health.response.status, 200);
    assert.match(health.response.headers.get('content-type') ?? '', /^application\/json;\s*charset=utf-8$/i);
    assert.equal(health.body.schemaVersion, 1);
    assert.equal(health.body.outcome, 'PASS');
    assert.equal(health.response.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);

    const configResponse = await request('/api/v1/config');
    assert.equal(configResponse.response.status, 200);
    assert.equal(configResponse.body.source.chainId, 11155111);
    assert.equal(configResponse.body.destination.chainId, 102031);
    assert.equal(configResponse.body.features.rawProofInApi, false);
    assert.equal(configResponse.body.features.mutations, false);
    assert.equal(configResponse.response.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    assert.doesNotMatch(configResponse.text, /PRIVATE_KEY|SESSION_SECRET|DATABASE_URL|workerPrivateKey|sourceRpc|destinationRpc/i);

    const validJob = await request(`/api/v1/proof-jobs/${JOB_ID}`);
    assert.equal(validJob.response.status, 200);
    assert.equal(validJob.body.jobId, JOB_ID);
    assert.equal(validJob.body.jobState, 'AWAITING_ATTESTATION');
    assert.equal(validJob.body.policyState, 'FUNDED');
    assert.equal(validJob.body.source.transactionHash, SOURCE_HASH);
    assert.equal(validJob.body.attestcoin.rawProof, null);
    assert.deepEqual(validJob.body.evidenceReferences, ['evidence/http-transport-fixture.json']);
    assert.equal(validJob.body.error.class, 'UNKNOWN');
    assert.doesNotMatch(validJob.text, /do-not-leak|127\.0\.0\.1|\/home\/unify\/creditcoin|\.env|txBytes|proofBytes/i);

    const status = await request(`/api/v1/tournaments/${TOURNAMENT_ID}/status`);
    assert.equal(status.response.status, 200);
    assert.equal(status.body.jobId, JOB_ID);
    assert.equal(status.body.jobState, 'AWAITING_ATTESTATION');
    assert.equal(status.body.policyState, 'FUNDED');

    const evidence = await request(`/api/v1/tournaments/${TOURNAMENT_ID}/evidence`);
    assert.equal(evidence.response.status, 200);
    assert.equal(evidence.body.policy.state, 1);
    assert.equal(evidence.body.source.tournamentId, TOURNAMENT_ID);
    assert.equal(evidence.body.attestcoin.rawProof, null);

    const invalidJob = await request('/api/v1/proof-jobs/not-a-job-id');
    assert.equal(invalidJob.response.status, 400);
    assert.equal(invalidJob.body.error.code, 'INVALID_INPUT');
    const missingJob = await request(`/api/v1/proof-jobs/job-${'b'.repeat(24)}`);
    assert.equal(missingJob.response.status, 404);
    assert.equal(missingJob.body.error.code, 'NOT_FOUND');
    const malformedTournament = await request('/api/v1/tournaments/not-a-bytes32-id/status');
    assert.equal(malformedTournament.response.status, 400);
    assert.equal(malformedTournament.body.error.code, 'INVALID_INPUT');

    const method = await request('/api/v1/config', { method: 'POST' });
    assert.equal(method.response.status, 405);
    assert.equal(method.body.error.code, 'METHOD_NOT_ALLOWED');
    assert.match(method.response.headers.get('content-type') ?? '', /^application\/json;\s*charset=utf-8$/i);

    // Exercise the preflight path through the same socket. Use a valid-looking
    // route segment; OPTIONS is handled before route validation.
    const preflight = await request(`/api/v1/proof-jobs/${JOB_ID}`, { method: 'OPTIONS' });
    assert.equal(preflight.response.status, 204);
    assert.equal(preflight.response.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    assert.equal(preflight.response.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
    assert.equal(preflight.response.headers.get('access-control-allow-headers'), 'Accept, Content-Type');

    const disallowed = await fetch(`${baseUrl}/api/v1/config`, { headers: { Origin: 'https://untrusted.example', Connection: 'close' } });
    assert.equal(disallowed.status, 200);
    assert.equal(disallowed.headers.get('access-control-allow-origin'), null);
    await disallowed.arrayBuffer();
  } finally {
    if (server) await close(server);
    if (previousOrigins === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = previousOrigins;
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
  assert.equal(server?.listening, false);
});
