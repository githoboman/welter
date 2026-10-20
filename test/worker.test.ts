import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AbiCoder, Interface, keccak256 } from 'ethers';
import test from 'node:test';
import { DurableStore, isTerminalState } from '../src/durable-store.js';
import { envelope, PrizeRailApi } from '../src/api.js';
import { ASC_ABI, VAULT_ABI, classifyError, isProofResumableState, validProofShape, WorkerRuntime } from '../src/worker-runtime.js';
import type { WorkerJob } from '../src/worker-types.js';

function job(id: string): WorkerJob {
  const at = new Date().toISOString();
  const matchId = `0x${'4'.repeat(64)}`;
  const resultNonce = BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32'], [matchId]))).toString();
  return {
    schemaVersion: 1, jobId: id, sourceChainId: 11155111, sourceChainKey: 1, sourceTransactionHash: `0x${'1'.repeat(64)}`, sourceBlockNumber: 10, sourceBlockHash: null, sourceGas: null, sourceTimestamp: null, sourceRegistry: `0x${'2'.repeat(40)}`, sourceEventSignature: 'MatchFinalized(bytes32,bytes32,address,address,address,uint8,bytes32,uint256,uint8,uint64,uint64,uint64)', tournamentId: `0x${'3'.repeat(64)}`, matchId, playerOne: `0x${'5'.repeat(40)}`, playerTwo: `0x${'6'.repeat(40)}`, winner: `0x${'5'.repeat(40)}`, result: 1, rulesHash: `0x${'7'.repeat(64)}`, resultNonce, finalizationStatus: 0, sourceDeadline: '100', sourceFinalizedAt: '90', sourceReceiptStatus: 1,
    state: 'MINED', productState: 'MINED', dataMode: 'LIVE', outcome: 'PASS', evidenceOutcome: 'PASS', attemptCount: 0, retryCount: 0, nextRetryAt: null, lease: null, createdAt: at, updatedAt: at, proofStatus: 'NOT_REQUESTED', proofHeader: null, proofDigest: null, proofCached: null, proofLatencyMs: null, proofPreflightOutcome: 'UNKNOWN', settlementTransactionHash: null, settlementReceiptStatus: null, settlementBlock: null, settlementGas: null, settlementTimestamp: null, payoutTransactionHash: null, payoutReceiptStatus: null, payoutBlock: null, payoutGas: null, payoutTimestamp: null, replayEvidence: null, refundRecoveryEvidence: null, policyState: null, policy: null, resultVerified: null, tournamentSettled: null, prizeClaimed: null, explorerLinks: { source: null, settlement: null, payout: null, replay: null, recovery: null }, lastErrorClass: null, lastErrorMessage: null, evidenceReferences: [],
  };
}

test('journal survives restart and keeps source/business indexes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-worker-'));
  try {
    const first = await DurableStore.open(directory, 10);
    const sourceJob = job('job-a');
    await first.saveJob(sourceJob, 'test create');
    await first.setCursor({ schemaVersion: 1, nextBlock: 21, lastScannedBlock: 20, updatedAt: new Date().toISOString() });
    const second = await DurableStore.open(directory, 10);
    assert.equal(second.getCursor().nextBlock, 21);
    assert.equal(second.getJob('job-a')?.tournamentId, sourceJob.tournamentId);
    assert.equal(second.getJobBySource(11155111, sourceJob.sourceTransactionHash)?.jobId, 'job-a');
    assert.equal(second.getJobByTournament(sourceJob.tournamentId)?.jobId, 'job-a');
    assert.equal(second.getTransitions('job-a').length, 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('job creation is idempotent across source and business keys', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-idempotency-'));
  try {
    const store = await DurableStore.open(directory, 1);
    const first = await store.createJob(job('job-source-a'), 'first');
    assert.equal(first.created, true);
    const duplicateSource = await store.createJob({ ...job('job-source-b') }, 'duplicate source');
    assert.equal(duplicateSource.created, false);
    assert.equal(duplicateSource.job.jobId, 'job-source-a');
    const duplicateBusiness = await store.createJob({ ...job('job-business-b'), sourceTransactionHash: `0x${'9'.repeat(64)}` }, 'duplicate business');
    assert.equal(duplicateBusiness.created, false);
    assert.equal(duplicateBusiness.job.jobId, 'job-source-a');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('job creation rejects a tournament-only identity collision', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-tournament-collision-'));
  try {
    const store = await DurableStore.open(directory, 1);
    await store.createJob(job('job-tournament-owner'), 'first');
    const conflicting = {
      ...job('job-tournament-conflict'),
      sourceTransactionHash: `0x${'9'.repeat(64)}`,
      resultNonce: '9',
    };
    await assert.rejects(
      store.createJob(conflicting, 'tournament collision'),
      /tournament identity collision/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a crash-tail journal record is repaired on restart', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-tail-'));
  try {
    const store = await DurableStore.open(directory, 1);
    await store.saveJob(job('job-tail'), 'tail seed');
    await fs.appendFile(path.join(directory, 'worker.journal'), '{"op":"job"');
    const restarted = await DurableStore.open(directory, 1);
    assert.equal(restarted.getJob('job-tail')?.jobId, 'job-tail');
    await restarted.setCursor({ schemaVersion: 1, nextBlock: 2, lastScannedBlock: 1, updatedAt: new Date().toISOString() });
    assert.equal(restarted.getCursor().nextBlock, 2);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a complete malformed final journal record fails closed', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-corrupt-tail-'));
  try {
    const store = await DurableStore.open(directory, 1);
    await store.saveJob(job('job-corrupt-tail'), 'seed');
    await fs.appendFile(path.join(directory, 'worker.journal'), '{"op":"unknown"}');
    await assert.rejects(DurableStore.open(directory, 1), /journal corruption/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('journal rejects structurally malformed complete records before projection', async () => {
  const validTime = new Date().toISOString();
  const malformedRecords: unknown[] = [
    { op: 'cursor', cursor: { schemaVersion: 1, nextBlock: Number.MAX_SAFE_INTEGER + 1, lastScannedBlock: null, updatedAt: validTime } },
    { op: 'observation', observation: { sourceChainId: 11155111, sourceChainKey: 1, transactionHash: '__proto__', blockNumber: 1, registry: `0x${'2'.repeat(40)}`, eventSignature: 'MatchFinalized', receiptStatus: 1, observedAt: validTime } },
    { op: 'heartbeat', heartbeat: { owner: '', at: validTime } },
    { op: 'transition', transition: { at: validTime, jobId: 'not-a-job-id', from: null, to: 'MINED', reason: 'malformed' } },
    { op: 'job', job: { ...job('job-malformed-journal'), sourceTransactionHash: '__proto__' } },
  ];
  for (const record of malformedRecords) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-journal-schema-'));
    try {
      await fs.writeFile(path.join(directory, 'worker.journal'), `${JSON.stringify(record)}\n`, { mode: 0o600 });
      await assert.rejects(DurableStore.open(directory, 1), /journal corruption/);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
});

test('a lock contender does not remove another writer lock after timeout', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-lock-contender-'));
  let held: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const store = await DurableStore.open(directory, 1);
    held = await fs.open(store.lockPath, 'wx', 0o600);
    await assert.rejects(
      store.setCursor({ schemaVersion: 1, nextBlock: 2, lastScannedBlock: 1, updatedAt: new Date().toISOString() }),
      /could not acquire worker store lock/,
    );
    await assert.doesNotReject(fs.stat(store.lockPath));
  } finally {
    await held?.close().catch(() => undefined);
    await fs.unlink(path.join(directory, 'worker.lock')).catch(() => undefined);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a fresh lock owned by a dead process is reclaimed on restart', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-dead-lock-'));
  try {
    const store = await DurableStore.open(directory, 1);
    await fs.writeFile(store.lockPath, '99999999:1\n', { mode: 0o600, flag: 'wx' });
    await store.setCursor({ schemaVersion: 1, nextBlock: 2, lastScannedBlock: 1, updatedAt: new Date().toISOString() });
    assert.equal(store.getCursor().nextBlock, 2);
    await assert.rejects(fs.stat(store.lockPath), { code: 'ENOENT' });
  } finally {
    await fs.unlink(path.join(directory, 'worker.lock')).catch(() => undefined);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('lease blocks a live owner and recovers after expiry', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-lease-'));
  try {
    const store = await DurableStore.open(directory, 1);
    await store.saveJob(job('job-b'), 'test create');
    assert.ok(await store.claimLease('job-b', 'owner-a', 2_000));
    assert.equal(await store.claimLease('job-b', 'owner-b', 2_000), undefined);
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    // Keep the recovered lease comfortably above journal-lock scheduling
    // variance; the first lease expiry is what this test exercises.
    assert.ok(await store.claimLease('job-b', 'owner-b', 30_000));
    assert.equal(await store.releaseLease('job-b', 'owner-b'), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('leased saves preserve the latest durable renewal', async () => {
  const stale = {
    ...job('job-renewed-save'),
    lease: { owner: 'owner-a', expiresAt: new Date(Date.now() + 1_000).toISOString() },
  };
  const renewedLease = { owner: 'owner-a', expiresAt: new Date(Date.now() + 60_000).toISOString() };
  let persisted: WorkerJob | null = null;
  const runtime: any = Object.create(WorkerRuntime.prototype);
  runtime.activeLeaseOwner = 'owner-a';
  runtime.leaseLost = false;
  runtime.store = {
    getJob: () => ({ ...stale, lease: renewedLease }),
    saveJob: async (value: WorkerJob, _reason: string, owner: string) => {
      assert.equal(owner, 'owner-a');
      persisted = value;
    },
  };
  const saved = await (WorkerRuntime.prototype as any).save.call(runtime, stale, 'renewed save', { state: 'AWAITING_ATTESTATION' });
  assert.deepEqual(saved.lease, renewedLease);
  assert.deepEqual(persisted?.lease, renewedLease);

  runtime.store.getJob = () => ({ ...stale, lease: { ...renewedLease, owner: 'owner-b' } });
  await assert.rejects(
    (WorkerRuntime.prototype as any).save.call(runtime, stale, 'stolen lease'),
    /LEASE_LOST/,
  );
});

test('worker abandons a fenced lease loss without persisting a retry', async () => {
  const candidate = {
    ...job('job-fenced-abandon'),
    lease: { owner: 'owner-a', expiresAt: new Date(Date.now() + 60_000).toISOString() },
  };
  let retried = false;
  const runtime: any = Object.create(WorkerRuntime.prototype);
  runtime.runtimeId = 'owner-a';
  runtime.activeLeaseOwner = null;
  runtime.leaseLost = false;
  runtime.config = { leaseTtlMs: 60_000 };
  runtime.store = {
    claimLease: async () => candidate,
    renewLease: async () => true,
    releaseLease: async () => false,
  };
  runtime.admit = async () => { throw new Error('LEASE_LOST for job-fenced-abandon'); };
  runtime.failOrRetry = async () => { retried = true; throw new Error('must not persist after lease loss'); };
  await assert.doesNotReject((WorkerRuntime.prototype as any).processJob.call(runtime, candidate));
  assert.equal(retried, false);
});

test('API envelope omits raw proof material and preserves live state', () => {
  const value = envelope(job('job-c'));
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.dataMode, 'LIVE');
  assert.equal(value.attestcoin.rawProof, null);
  assert.equal(value.source?.transactionHash, `0x${'1'.repeat(64)}`);
});

test('API sanitizes journal evidence passthroughs and lifecycle records', () => {
  const jobId = `job-${'a'.repeat(24)}`;
  const value = envelope({
    ...job(jobId),
    replayEvidence: {
      rejected: true,
      outcome: 'PASS',
      hash: `0x${'A'.repeat(64)}`,
      status: 0,
      blockNumber: '42',
      gasUsed: '153230',
      detectedAt: '2026-09-12T00:00:00.000Z',
      reason: 'PRIVATE_KEY=should-not-leak',
      txBytes: '0xdeadbeef',
    },
    refundRecoveryEvidence: {
      outcome: 'PASS',
      beneficiary: `0x${'B'.repeat(40)}`,
      trigger: 'permissionless',
      settlementDeadline: 200,
      refundDeadline: 300,
      error: { class: 'RPC_UNAVAILABLE', message: 'DATABASE_URL=should-not-leak' },
      secret: 'DATABASE_URL=should-not-leak',
    },
    evidenceReferences: ['evidence/good.json', 'evidence/good.json', '../.env', '/tmp/private.json', 'evidence\\bad.json'],
  }, undefined, undefined, [
    { at: '2026-09-12T00:00:00.000Z', jobId, from: null, to: 'MINED', reason: 'PRIVATE_KEY=should-not-leak' },
    { at: '2026-09-12T00:00:00.000Z', jobId: 'job-invalid', from: null, to: 'MINED', reason: 'ignored' },
    { at: 'not-a-time', jobId, from: null, to: 'MINED', reason: 'ignored' },
  ]);
  assert.equal((value.replay as any).hash, `0x${'a'.repeat(64)}`);
  assert.equal((value.replay as any).txBytes, undefined);
  assert.equal((value.replay as any).reason, '[secret-redacted]');
  assert.equal((value.refundRecovery as any).beneficiary, `0x${'b'.repeat(40)}`);
  assert.deepEqual((value.refundRecovery as any).error, { class: 'RPC_UNAVAILABLE', message: '[secret-redacted]' });
  assert.equal((value.refundRecovery as any).secret, undefined);
  assert.deepEqual(value.evidenceReferences, ['evidence/good.json']);
  assert.equal(value.lifecycle?.length, 1);
  assert.equal(value.lifecycle?.[0].reason, '[secret-redacted]');
  assert.equal((envelope({ ...job('job-malformed-evidence'), replayEvidence: { rejected: true, outcome: 'PASS' } }).replay as any).outcome, 'UNKNOWN');
});

test('API treats an explicit fresh null policy as unknown instead of using journal state', () => {
  const candidate = {
    ...job('job-fresh-null-policy'),
    state: 'CLAIMED' as const,
    productState: 'CLAIMED' as const,
    outcome: 'PASS' as const,
    policyState: 3,
    policy: { state: 3, amount: '1', winner: job('job-fresh-null-policy').winner },
    settlementTransactionHash: `0x${'a'.repeat(64)}`,
    settlementReceiptStatus: 1,
    resultVerified: true,
    tournamentSettled: true,
    payoutTransactionHash: `0x${'b'.repeat(64)}`,
    payoutReceiptStatus: 1,
    prizeClaimed: true,
  };
  const response = envelope(candidate, null, { vault: `0x${'9'.repeat(40)}`, asc: `0x${'a'.repeat(40)}` } as any);
  assert.equal(response.policyState, null);
  assert.equal(response.productState, 'UNKNOWN');
  assert.equal(response.outcome, 'UNKNOWN');
  assert.equal(response.payout.amount, null);
});

test('API treats out-of-range chain timestamps as unknown instead of throwing', () => {
  const value = envelope({
    ...job('job-timestamp-range'),
    sourceDeadline: '86400000000001',
    sourceFinalizedAt: '86400000000001',
  });
  assert.equal(value.source?.deadline, null);
  assert.equal(value.source?.finalizedAt, null);
});

test('API treats malformed latest-block timestamps as unknown policy timing', async () => {
  const config = apiConfig('/tmp/prizerail-api-block-timestamp');
  const policy = {
    organizer: `0x${'4'.repeat(40)}`,
    sourceChainKey: 1,
    sourceRegistry: config.sourceRegistry,
    rulesHash: `0x${'7'.repeat(64)}`,
    token: config.token,
    amount: '1',
    settlementDeadline: 200,
    refundDeadline: 300,
    winner: `0x${'5'.repeat(40)}`,
    resultNonce: '1',
    sourceQueryKey: `0x${'6'.repeat(64)}`,
    state: 1,
  };
  for (const timestamp of [Number.NaN, -1, Number.MAX_SAFE_INTEGER + 1, 'not-a-timestamp', '9007199254740992']) {
    const runtime: any = { config, destinationProvider: { getBlock: async () => ({ timestamp }) } };
    const api = new PrizeRailApi(runtime, config);
    const result = await (api as any).derivedPolicy(policy);
    assert.equal(result.state, 'FUNDED');
    assert.equal(result.evidence.outcome, 'UNKNOWN');
  }
});

test('API preserves policy and derived deadline product states', async () => {
  const config = apiConfig('/tmp/prizerail-api-derived-policy-state');
  const tournamentId = `0x${'8'.repeat(64)}`;
  const zeroAddress = `0x${'0'.repeat(40)}`;
  const policy = {
    organizer: `0x${'4'.repeat(40)}`,
    sourceChainKey: 1,
    sourceRegistry: config.sourceRegistry,
    rulesHash: `0x${'7'.repeat(64)}`,
    token: config.token,
    amount: '1',
    settlementDeadline: 200,
    refundDeadline: 300,
    winner: zeroAddress,
    resultNonce: '0',
    sourceQueryKey: `0x${'0'.repeat(64)}`,
    state: 1,
  };
  let timestamp = 250;
  const runtime: any = {
    config,
    getConfigurationCheck: () => ({ outcome: 'PASS' }),
    store: { refresh: async () => undefined, getJobByTournament: () => undefined },
    vault: { policies: async () => policy },
    destinationProvider: { getBlock: async () => ({ timestamp }) },
  };
  const api = new PrizeRailApi(runtime, config);

  let response = await (api as any).route('GET', `/api/v1/tournaments/${tournamentId}/status`);
  assert.equal(response.body.policyState, 'FUNDED');
  assert.equal(response.body.productState, 'REFUND_AVAILABLE');
  assert.equal(response.body.outcome, 'PASS');

  timestamp = 301;
  response = await (api as any).route('GET', `/api/v1/tournaments/${tournamentId}/status`);
  assert.equal(response.body.policyState, 'FUNDED');
  assert.equal(response.body.productState, 'RECOVERY_AVAILABLE');

  policy.state = 0;
  timestamp = 1;
  response = await (api as any).route('GET', `/api/v1/tournaments/${tournamentId}/status`);
  assert.equal(response.body.policyState, 'DRAFT');
  assert.equal(response.body.productState, 'DRAFT');
});

test('terminal states include permanent proof preflight failure', () => {
  assert.equal(isTerminalState('VERIFICATION_FAILED'), true);
  assert.equal(isTerminalState('REPLAY_REJECTED'), true);
});

test('in-flight proof jobs resume after restart and terminal payout evidence is explicit', () => {
  assert.equal(isProofResumableState('MINED'), true);
  assert.equal(isProofResumableState('AWAITING_ATTESTATION'), true);
  assert.equal(isProofResumableState('PROOF_READY'), true);
  assert.equal(isProofResumableState('PROOF_PREFLIGHT_PASS'), true);
  assert.equal(isProofResumableState('CLAIMED'), false);
  const claimedWithoutReceipt = { ...job('job-claimed'), state: 'CLAIMED' as const, productState: 'CLAIMED' as const, policyState: 3, payoutReceiptStatus: null, prizeClaimed: null };
  const response = envelope(claimedWithoutReceipt);
  assert.equal(response.productState, 'UNKNOWN');
  assert.equal(response.outcome, 'UNKNOWN');
  assert.equal(response.error?.class, 'INCONSISTENT_CLAIM_EVIDENCE');
  assert.equal(response.payout.prizeClaimed, null);
  assert.equal(response.payout.receiptStatus, null);
  const claimedWithReceipt = {
    ...claimedWithoutReceipt,
    settlementTransactionHash: `0x${'a'.repeat(64)}`,
    settlementReceiptStatus: 1,
    resultVerified: true,
    tournamentSettled: true,
    payoutTransactionHash: `0x${'b'.repeat(64)}`,
    payoutReceiptStatus: 1,
    prizeClaimed: true,
  };
  assert.equal(envelope(claimedWithReceipt).productState, 'CLAIMED');
});

test('proof shape rejects empty or odd-length transaction bytes', () => {
  const base: any = {
    chainKey: 1,
    headerNumber: 10,
    txHash: `0x${'1'.repeat(64)}`,
    txBytes: '0x12',
    merkleProof: { root: `0x${'2'.repeat(64)}`, siblings: [] },
    continuityProof: { lowerEndpointDigest: `0x${'3'.repeat(64)}`, roots: [] },
  };
  assert.equal(validProofShape(base), true);
  assert.equal(validProofShape({ ...base, txBytes: '0x' }), false);
  assert.equal(validProofShape({ ...base, txBytes: '0x1' }), false);
});

test('API rejects mutation methods and malformed tournament IDs', async () => {
  const api = new PrizeRailApi({ store: { refresh: async () => undefined } } as any, {} as any);
  const method = await (api as any).route('POST', '/api/v1/config');
  assert.equal(method.status, 405);
  assert.equal(method.body.error.code, 'METHOD_NOT_ALLOWED');
  const malformed = await (api as any).route('GET', '/api/v1/tournaments/not-a-bytes32-id');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, 'INVALID_INPUT');
});

test('error classification keeps transient network failures UNKNOWN and semantic failures terminal', () => {
  const transient = classifyError(new Error('socket timeout while reading RPC response'));
  assert.equal(transient.errorClass, 'RPC_UNAVAILABLE');
  assert.equal(transient.retryable, true);
  const semantic = classifyError(new Error('policy expired before settlement'));
  assert.equal(semantic.errorClass, 'POLICY_EXPIRED');
  assert.equal(semantic.retryable, false);
});

test('source admission requires the canonical event signature and deployment-era block', async () => {
  const config = apiConfig('/tmp/prizerail-source-predicate-boundary');
  const candidate = job('job-source-predicate-boundary');
  const policy = {
    organizer: `0x${'4'.repeat(40)}`,
    sourceChainKey: 1,
    sourceRegistry: config.sourceRegistry,
    rulesHash: candidate.rulesHash,
    token: config.token,
    amount: '1',
    settlementDeadline: 200,
    refundDeadline: 300,
    winner: candidate.winner,
    resultNonce: candidate.resultNonce,
    sourceQueryKey: `0x${'0'.repeat(64)}`,
    state: 1,
  };
  const fake: any = {
    config,
    readPolicy: async () => policy,
    destinationProvider: { getBlock: async () => ({ timestamp: 100 }) },
    asc: { usedBusinessResults: async () => false },
  };
  const shorthand = await (WorkerRuntime.prototype as any).admit.call(fake, { ...candidate, sourceEventSignature: 'MatchFinalized' });
  assert.equal(shorthand.kind, 'PERMANENT_FAILURE');
  assert.equal(shorthand.errorClass, 'WRONG_EVENT');
  const beforeDeployment = await (WorkerRuntime.prototype as any).admit.call(fake, { ...candidate, sourceBlockNumber: 0 });
  assert.equal(beforeDeployment.kind, 'PERMANENT_FAILURE');
  assert.equal(beforeDeployment.errorClass, 'INVALID_INPUT');
  const zeroBlockHash = await (WorkerRuntime.prototype as any).admit.call(fake, { ...candidate, sourceBlockHash: `0x${'0'.repeat(64)}` });
  assert.equal(zeroBlockHash.kind, 'PERMANENT_FAILURE');
  assert.equal(zeroBlockHash.errorClass, 'INVALID_INPUT');
});

test('API envelope remains LIVE and contains no server credentials', () => {
  const response = envelope(job('job-secrets'));
  const serialized = JSON.stringify(response);
  assert.equal(response.dataMode, 'LIVE');
  assert.equal(serialized.includes('PRIVATE_KEY'), false);
  assert.equal(serialized.includes('SESSION_SECRET'), false);
  assert.equal(serialized.includes('DATABASE_URL'), false);
  assert.equal(serialized.includes('txBytes'), false);
  assert.equal(response.attestcoin.rawProof, null);
});

test('policy admission rejects a missing, unfunded, mismatched, draw, expired, refunded, or replayed policy', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-admission-'));
  try {
    const store = await DurableStore.open(directory, 1);
    const config: any = {
      root: process.cwd(), sourceRpc: 'http://127.0.0.1:1', destinationRpc: 'http://127.0.0.1:1', proverUrl: 'http://127.0.0.1:1',
      sourceChainId: 11155111, destinationChainId: 102031, sourceChainKey: 1, sourceRegistry: `0x${'2'.repeat(40)}`, sourceFinalizer: `0x${'5'.repeat(40)}`,
      sourceDeploymentBlock: 1, sourceStartBlock: 1, destinationDeploymentBlock: 1, token: `0x${'8'.repeat(40)}`, vault: `0x${'9'.repeat(40)}`, asc: `0x${'a'.repeat(40)}`,
      expectedBlockProver: `0x${'b'.repeat(40)}`, expectedChainInfo: `0x${'c'.repeat(40)}`, workerPrivateKey: undefined, autoClaim: false, confirmations: 1,
      batchSize: 10, pollIntervalMs: 100, maxAttempts: 2, leaseTtlMs: 1_000, reorgRewind: 1, dataDirectory: directory, sourceExplorer: 'https://source', destinationExplorer: 'https://destination',
      deploymentFile: 'evidence/current-deployment.json', manifest: { protocolVersion: 'post-fix-v2', source: { chainId: 11155111, chainKey: 1, contract: `0x${'2'.repeat(40)}`, deployer: `0x${'5'.repeat(40)}`, rulesHash: `0x${'7'.repeat(64)}` }, destination: { chainId: 102031, deployer: `0x${'5'.repeat(40)}`, token: { address: `0x${'8'.repeat(40)}`, deploymentBlock: 1 }, vault: { address: `0x${'9'.repeat(40)}`, deploymentBlock: 1 }, asc: { address: `0x${'a'.repeat(40)}`, deploymentBlock: 1 }, expectedBlockProver: `0x${'b'.repeat(40)}`, expectedChainInfo: `0x${'c'.repeat(40)}` } },
    };
    const runtime: any = new (WorkerRuntime as any)(config, store);
    runtime.destinationProvider = { getBlock: async () => ({ timestamp: 100 }) };
    runtime.asc = { usedBusinessResults: async () => false };
    const candidate = job('job-admission');
    const policy = (state: number, overrides: Record<string, unknown> = {}) => ({ organizer: `0x${'4'.repeat(40)}`, sourceChainKey: 1, sourceRegistry: config.sourceRegistry, rulesHash: candidate.rulesHash, token: config.token, amount: '1', settlementDeadline: 200, refundDeadline: 300, winner: candidate.winner, resultNonce: candidate.resultNonce, sourceQueryKey: `0x${'0'.repeat(64)}`, state, ...overrides });
    runtime.vault = { policies: async () => policy(0) };
    assert.equal((await runtime.admit(candidate)).kind, 'WAITING_FOR_POLICY');
    runtime.vault = { policies: async () => policy(1) };
    assert.equal((await runtime.admit(candidate)).kind, 'ACCEPTED');
    runtime.destinationProvider = { getBlock: async () => ({ timestamp: Number.NaN }) };
    const malformedLatest = await runtime.admit(candidate);
    assert.equal(malformedLatest.kind, 'INFRASTRUCTURE_UNAVAILABLE');
    assert.equal(malformedLatest.errorClass, 'RPC_UNAVAILABLE');
    runtime.destinationProvider = { getBlock: async () => ({ timestamp: 100 }) };
    runtime.vault = { policies: async () => policy(1, { sourceRegistry: `0x${'d'.repeat(40)}` }) };
    assert.equal((await runtime.admit(candidate)).errorClass, 'WRONG_SOURCE_REGISTRY');
    runtime.vault = { policies: async () => policy(1, { rulesHash: `0x${'e'.repeat(64)}` }) };
    assert.equal((await runtime.admit(candidate)).errorClass, 'WRONG_RULES');
    const drawCandidate = { ...candidate, result: 0, winner: `0x${'0'.repeat(40)}` };
    runtime.vault = { policies: async () => policy(1) };
    assert.equal((await runtime.admit(drawCandidate)).kind, 'NON_PAYABLE_RESULT');
    runtime.vault = { policies: async () => policy(1, { settlementDeadline: 50 }) };
    assert.equal((await runtime.admit(candidate)).errorClass, 'POLICY_EXPIRED');
    runtime.vault = { policies: async () => policy(4) };
    assert.equal((await runtime.admit(candidate)).kind, 'REFUNDED');
    runtime.vault = { policies: async () => policy(1) };
    runtime.asc = { usedBusinessResults: async () => true };
    assert.equal((await runtime.admit(candidate)).errorClass, 'REPLAYED');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('payout timeout preserves the submitted hash for reconciliation', async () => {
  const candidate = { ...job('job-payout-timeout'), state: 'CLAIMABLE' as const, productState: 'CLAIMABLE' as const, policyState: 2 };
  const payoutHash = `0x${'a'.repeat(64)}`;
  const saved: WorkerJob[] = [];
  const fake: any = {
    config: { autoClaim: true, token: `0x${'8'.repeat(40)}` },
    workerSigner: {},
    destinationExplorer: (hash: string) => `https://destination/tx/${hash}`,
    readPolicy: async () => ({ state: 2, sourceChainKey: candidate.sourceChainKey, sourceRegistry: candidate.sourceRegistry, rulesHash: candidate.rulesHash, token: `0x${'8'.repeat(40)}`, resultNonce: candidate.resultNonce, winner: candidate.winner, amount: '1' }),
    policyMatchesJob: (WorkerRuntime.prototype as any).policyMatchesJob,
    store: { saveJob: async (value: WorkerJob) => { saved.push(value); } },
    vault: { claimFor: async () => ({ hash: payoutHash }) },
    waitForReceipt: async () => null,
    reconcileExistingState: async (value: WorkerJob) => value,
    assertLease: () => undefined,
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => {
      const updated = { ...value, ...patch };
      saved.push(updated);
      return updated;
    },
  };
  const result = await (WorkerRuntime.prototype as any).submitPayout.call(fake, candidate);
  assert.equal(result.state, 'PAYOUT_PENDING');
  assert.equal(result.outcome, 'UNKNOWN');
  assert.equal(result.payoutTransactionHash, payoutHash);
  assert.ok(saved.some((value) => value.payoutTransactionHash === payoutHash));
});

test('settlement broadcast is fenced when reconciliation observes a missing policy', async () => {
  const candidate = { ...job('job-settlement-policy-race'), state: 'PROOF_PREFLIGHT_PASS' as const, productState: 'PROOF_PREFLIGHT_PASS' as const, policyState: 1 };
  let broadcasts = 0;
  const fake: any = {
    config: { autoClaim: false, sourceRegistry: candidate.sourceRegistry, sourceChainKey: candidate.sourceChainKey, asc: `0x${'a'.repeat(40)}` },
    workerSigner: {},
    admit: async () => ({ kind: 'ACCEPTED', policy: { state: 1 } }),
    reconcileExistingState: async () => ({ ...candidate, state: 'WAITING_FOR_POLICY', productState: 'WAITING_FOR_POLICY', policyState: 0 }),
    asc: { usedSourceQueries: async () => false, usedBusinessResults: async () => false, verifyAndSettle: async () => { broadcasts += 1; return { hash: `0x${'a'.repeat(64)}` }; } },
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch }),
  };
  const result = await (WorkerRuntime.prototype as any).submitSettlement.call(fake, candidate, {} as any);
  assert.equal(result.state, 'WAITING_FOR_POLICY');
  assert.equal(broadcasts, 0);
});

test('payout broadcast is fenced when reconciliation observes an unfunded policy', async () => {
  const candidate = {
    ...job('job-payout-policy-race'),
    state: 'CLAIMABLE' as const,
    productState: 'CLAIMABLE' as const,
    policyState: 2,
    settlementTransactionHash: `0x${'a'.repeat(64)}`,
    settlementReceiptStatus: 1,
    resultVerified: true,
    tournamentSettled: true,
  };
  const policy = { state: 2, sourceChainKey: candidate.sourceChainKey, sourceRegistry: candidate.sourceRegistry, rulesHash: candidate.rulesHash, token: `0x${'8'.repeat(40)}`, resultNonce: candidate.resultNonce, winner: candidate.winner, amount: '1' };
  let broadcasts = 0;
  const fake: any = {
    config: { autoClaim: true, token: `0x${'8'.repeat(40)}` },
    workerSigner: {},
    readPolicy: async () => policy,
    policyMatchesJob: (WorkerRuntime.prototype as any).policyMatchesJob,
    hasBoundSettlementEvidence: (WorkerRuntime.prototype as any).hasBoundSettlementEvidence,
    reconcileExistingState: async () => ({ ...candidate, state: 'WAITING_FOR_POLICY', productState: 'WAITING_FOR_POLICY', policyState: 0 }),
    vault: { claimFor: async () => { broadcasts += 1; return { hash: `0x${'b'.repeat(64)}` }; } },
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch }),
  };
  const result = await (WorkerRuntime.prototype as any).submitPayout.call(fake, candidate);
  assert.equal(result.state, 'WAITING_FOR_POLICY');
  assert.equal(broadcasts, 0);
});

test('settlement timeout preserves the submitted hash for reconciliation', async () => {
  const candidate = { ...job('job-settlement-timeout'), state: 'PROOF_PREFLIGHT_PASS' as const, productState: 'PROOF_PREFLIGHT_PASS' as const, policyState: 1 };
  const settlementHash = `0x${'b'.repeat(64)}`;
  const saved: WorkerJob[] = [];
  const fake: any = {
    config: { autoClaim: false, sourceRegistry: candidate.sourceRegistry, sourceChainKey: candidate.sourceChainKey, asc: `0x${'a'.repeat(40)}` },
    workerSigner: {},
    destinationExplorer: (hash: string) => `https://destination/tx/${hash}`,
    admit: async () => ({ kind: 'ACCEPTED', policy: { state: 1 } }),
    asc: {
      usedSourceQueries: async () => false,
      usedBusinessResults: async () => false,
      verifyAndSettle: async () => ({ hash: settlementHash }),
    },
    store: { saveJob: async (value: WorkerJob) => { saved.push(value); } },
    waitForReceipt: async () => null,
    reconcileExistingState: async (value: WorkerJob) => value,
    assertLease: () => undefined,
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => {
      const updated = { ...value, ...patch };
      saved.push(updated);
      return updated;
    },
  };
  const proof: any = {
    chainKey: 1,
    headerNumber: 10,
    txHash: candidate.sourceTransactionHash,
    txBytes: '0x12',
    merkleProof: { root: `0x${'1'.repeat(64)}`, siblings: [] },
    continuityProof: { lowerEndpointDigest: `0x${'2'.repeat(64)}`, roots: [] },
  };
  const result = await (WorkerRuntime.prototype as any).submitSettlement.call(fake, candidate, proof);
  assert.equal(result.state, 'SETTLEMENT_PENDING');
  assert.equal(result.outcome, 'UNKNOWN');
  assert.equal(result.settlementTransactionHash, settlementHash);
  assert.ok(saved.some((value) => value.settlementTransactionHash === settlementHash));
});

test('failed settlement receipt honors an in-place unknown reconciliation', async () => {
  const settlementHash = `0x${'d'.repeat(64)}`;
  const candidate = {
    ...job('job-failed-settlement-in-place-unknown'),
    state: 'SETTLEMENT_PENDING' as const,
    productState: 'SETTLEMENT_PENDING' as const,
    settlementTransactionHash: settlementHash,
    policyState: 1,
  };
  const fake: any = {
    config: { asc: `0x${'a'.repeat(40)}` },
    destinationProvider: {
      getTransactionReceipt: async () => ({ status: 0, blockNumber: 12, gasUsed: 21 }),
    },
    // Return the same reference to exercise the reconciler contract without
    // relying on object identity as a proxy for a fresh chain read.
    reconcileExistingState: async (value: WorkerJob) => {
      value.state = 'UNKNOWN';
      value.productState = 'UNKNOWN';
      value.outcome = 'UNKNOWN';
      value.evidenceOutcome = 'UNKNOWN';
      value.lastErrorClass = 'RPC_UNAVAILABLE';
      value.lastErrorMessage = 'destination policy read timed out';
      return value;
    },
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch }),
  };
  const result = await (WorkerRuntime.prototype as any).reconcileSettlement.call(fake, candidate, null);
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.outcome, 'UNKNOWN');
  assert.equal(result.lastErrorClass, 'RPC_UNAVAILABLE');
  assert.equal(result.settlementReceiptStatus, null);
});

test('failed settlement receipt honors an in-place advanced policy observation', async () => {
  const settlementHash = `0x${'e'.repeat(64)}`;
  const candidate = {
    ...job('job-failed-settlement-in-place-advanced'),
    state: 'SETTLEMENT_PENDING' as const,
    productState: 'SETTLEMENT_PENDING' as const,
    settlementTransactionHash: settlementHash,
    policyState: 1,
  };
  const fake: any = {
    config: { asc: `0x${'a'.repeat(40)}` },
    destinationProvider: {
      getTransactionReceipt: async () => ({ status: 0, blockNumber: 13, gasUsed: 22 }),
    },
    reconcileExistingState: async (value: WorkerJob) => {
      value.policyState = 2;
      value.state = 'SETTLEMENT_COMPLETE';
      value.productState = 'CLAIMABLE';
      value.outcome = 'PASS';
      value.evidenceOutcome = 'PASS';
      return value;
    },
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch }),
  };
  const result = await (WorkerRuntime.prototype as any).reconcileSettlement.call(fake, candidate, null);
  assert.equal(result.state, 'SETTLEMENT_COMPLETE');
  assert.equal(result.productState, 'CLAIMABLE');
  assert.equal(result.policyState, 2);
  assert.equal(result.outcome, 'PASS');
  assert.equal(result.settlementReceiptStatus, null);
});

test('failed settlement receipt preserves terminal semantic reconciliation', async () => {
  const settlementHash = `0x${'f'.repeat(64)}`;
  const candidate = {
    ...job('job-failed-settlement-terminal'),
    state: 'SETTLEMENT_PENDING' as const,
    productState: 'SETTLEMENT_PENDING' as const,
    settlementTransactionHash: settlementHash,
    submissionUncertainty: true,
    submissionPhase: 'SETTLEMENT' as const,
  };
  const reconciled = {
    ...candidate,
    state: 'VERIFICATION_FAILED' as const,
    productState: 'VERIFICATION_FAILED' as const,
    outcome: 'FAIL' as const,
    evidenceOutcome: 'FAIL' as const,
    lastErrorClass: 'WRONG_RULES' as const,
    lastErrorMessage: 'policy rules hash does not match MatchFinalized',
    nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const fake: any = {
    config: { asc: `0x${'a'.repeat(40)}` },
    destinationProvider: {
      getTransactionReceipt: async () => ({ status: 0, blockNumber: 12, gasUsed: 21 }),
    },
    reconcileExistingState: async () => reconciled,
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch }),
  };
  const result = await (WorkerRuntime.prototype as any).reconcileSettlement.call(fake, candidate, null);
  assert.equal(result.state, 'VERIFICATION_FAILED');
  assert.equal(result.lastErrorClass, 'WRONG_RULES');
  assert.equal(result.lastErrorMessage, reconciled.lastErrorMessage);
  assert.equal(result.submissionUncertainty, false);
  assert.equal(result.submissionPhase, undefined);
  assert.equal(result.nextRetryAt, null);
});

test('uncertain settlement recovery preserves infrastructure diagnostics', async () => {
  const candidate = {
    ...job('job-uncertain-settlement-rpc'),
    state: 'SUBMITTING' as const,
    productState: 'SUBMITTING' as const,
    outcome: 'UNKNOWN' as const,
  };
  const retryAt = new Date(Date.now() + 60_000).toISOString();
  const reconciled = {
    ...candidate,
    state: 'INFRASTRUCTURE_UNAVAILABLE' as const,
    productState: 'INFRASTRUCTURE_UNAVAILABLE' as const,
    lastErrorClass: 'RPC_UNAVAILABLE' as const,
    lastErrorMessage: 'destination RPC timed out',
    nextRetryAt: retryAt,
  };
  const fake: any = {
    reconcileExistingState: async () => reconciled,
    hasBoundSettlementEvidence: (WorkerRuntime.prototype as any).hasBoundSettlementEvidence,
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch }),
  };

  const result = await (WorkerRuntime.prototype as any).recoverUncertainSubmission.call(fake, candidate);
  assert.equal(result.state, 'INFRASTRUCTURE_UNAVAILABLE');
  assert.equal(result.lastErrorClass, 'RPC_UNAVAILABLE');
  assert.equal(result.lastErrorMessage, 'destination RPC timed out');
  assert.equal(result.nextRetryAt, retryAt);
  assert.equal(result.submissionUncertainty, true);
});

test('a payout hash does not resolve an uncertain settlement broadcast', async () => {
  const candidate = {
    ...job('job-uncertain-settlement-payout'),
    state: 'SUBMITTING' as const,
    productState: 'SUBMITTING' as const,
    outcome: 'UNKNOWN' as const,
  };
  const reconciled = {
    ...candidate,
    state: 'UNKNOWN' as const,
    productState: 'UNKNOWN' as const,
    payoutTransactionHash: `0x${'c'.repeat(64)}`,
  };
  const fake: any = {
    reconcileExistingState: async () => reconciled,
    hasBoundSettlementEvidence: (WorkerRuntime.prototype as any).hasBoundSettlementEvidence,
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch }),
  };

  const result = await (WorkerRuntime.prototype as any).recoverUncertainSubmission.call(fake, candidate);
  assert.equal(result.settlementTransactionHash, null);
  assert.equal(result.payoutTransactionHash, reconciled.payoutTransactionHash);
  assert.equal(result.submissionUncertainty, true);
});

test('uncertain settlement recovery keeps a stale mined projection in the pending phase', async () => {
  const candidate = {
    ...job('job-uncertain-settlement-mined'),
    state: 'SUBMITTING' as const,
    productState: 'SUBMITTING' as const,
    outcome: 'UNKNOWN' as const,
    evidenceOutcome: 'UNKNOWN' as const,
    submissionUncertainty: true,
  };
  const retryAt = new Date(Date.now() + 60_000).toISOString();
  const reconciled = {
    ...candidate,
    state: 'MINED' as const,
    productState: 'MINED' as const,
    policyState: 1,
    nextRetryAt: retryAt,
  };
  const fake: any = {
    reconcileExistingState: async () => reconciled,
    hasBoundSettlementEvidence: (WorkerRuntime.prototype as any).hasBoundSettlementEvidence,
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch }),
  };
  const result = await (WorkerRuntime.prototype as any).recoverUncertainSubmission.call(fake, candidate);
  assert.equal(result.state, 'SETTLEMENT_PENDING');
  assert.equal(result.productState, 'SETTLEMENT_PENDING');
  assert.equal(result.outcome, 'UNKNOWN');
  assert.equal(result.submissionUncertainty, true);
  assert.equal(result.nextRetryAt, retryAt);
});

test('uncertain settlement recovery clears uncertainty on terminal validation failure', async () => {
  const candidate = {
    ...job('job-uncertain-settlement-terminal'),
    state: 'SUBMITTING' as const,
    productState: 'SUBMITTING' as const,
    outcome: 'UNKNOWN' as const,
    evidenceOutcome: 'UNKNOWN' as const,
    submissionUncertainty: true,
  };
  const reconciled = {
    ...candidate,
    state: 'VERIFICATION_FAILED' as const,
    productState: 'VERIFICATION_FAILED' as const,
    outcome: 'FAIL' as const,
    evidenceOutcome: 'FAIL' as const,
    lastErrorClass: 'WRONG_RULES' as const,
    lastErrorMessage: 'policy rules hash does not match MatchFinalized',
    nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const fake: any = {
    reconcileExistingState: async () => reconciled,
    hasBoundSettlementEvidence: (WorkerRuntime.prototype as any).hasBoundSettlementEvidence,
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch }),
  };
  const result = await (WorkerRuntime.prototype as any).recoverUncertainSubmission.call(fake, candidate);
  assert.equal(result.state, 'VERIFICATION_FAILED');
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.lastErrorClass, 'WRONG_RULES');
  assert.equal(result.submissionUncertainty, false);
  assert.equal(result.nextRetryAt, null);
});

test('uncertain payout recovery clears uncertainty on terminal validation failure', async () => {
  const candidate = {
    ...job('job-uncertain-payout-terminal'),
    state: 'PAYOUT_PENDING' as const,
    productState: 'PAYOUT_PENDING' as const,
    outcome: 'UNKNOWN' as const,
    evidenceOutcome: 'UNKNOWN' as const,
    submissionUncertainty: true,
  };
  const reconciled = {
    ...candidate,
    state: 'VERIFICATION_FAILED' as const,
    productState: 'VERIFICATION_FAILED' as const,
    outcome: 'FAIL' as const,
    evidenceOutcome: 'FAIL' as const,
    lastErrorClass: 'WRONG_WINNER' as const,
    lastErrorMessage: 'settled policy winner does not match MatchFinalized',
    nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const fake: any = {
    reconcileExistingState: async () => reconciled,
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch }),
  };
  const result = await (WorkerRuntime.prototype as any).recoverUncertainSubmission.call(fake, candidate);
  assert.equal(result.state, 'VERIFICATION_FAILED');
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.lastErrorClass, 'WRONG_WINNER');
  assert.equal(result.submissionUncertainty, false);
  assert.equal(result.nextRetryAt, null);
});

test('uncertain submission errors persist an explicit settlement or payout phase', async () => {
  const candidate = job('job-submission-phase');
  const fake: any = {
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch }),
  };
  const settlement = await (WorkerRuntime.prototype as any).failOrRetry.call(fake, candidate, new Error('socket timeout'), 'settlement submission failed');
  assert.equal(settlement.state, 'SETTLEMENT_PENDING');
  assert.equal(settlement.submissionUncertainty, true);
  assert.equal(settlement.submissionPhase, 'SETTLEMENT');
  const payout = await (WorkerRuntime.prototype as any).failOrRetry.call(fake, candidate, new Error('socket timeout'), 'payout submission failed');
  assert.equal(payout.state, 'PAYOUT_PENDING');
  assert.equal(payout.submissionUncertainty, true);
  assert.equal(payout.submissionPhase, 'PAYOUT');
});

test('transient retry preserves an assigned transaction identity across journal restart', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-retry-identity-'));
  try {
    const store = await DurableStore.open(directory, 1);
    const settlementHash = `0x${'c'.repeat(64)}`;
    const candidate = {
      ...job('job-retry-identity'),
      state: 'SETTLEMENT_PENDING' as const,
      productState: 'SETTLEMENT_PENDING' as const,
      settlementTransactionHash: settlementHash,
      submissionPhase: 'SETTLEMENT' as const,
    };
    await store.saveJob(candidate, 'seed submitted transaction');
    const fake: any = {
      config: { maxAttempts: 3 },
      save: async (value: WorkerJob, reason: string, patch: Partial<WorkerJob> = {}) => {
        const updated = { ...value, ...patch };
        await store.saveJob(updated, reason);
        return updated;
      },
    };
    const retried = await (WorkerRuntime.prototype as any).failOrRetry.call(fake, candidate, new Error('socket timeout'), 'existing settlement reconciliation failed');
    assert.equal(retried.settlementTransactionHash, settlementHash);
    assert.equal(retried.state, 'INFRASTRUCTURE_UNAVAILABLE');

    const restarted = await DurableStore.open(directory, 1);
    assert.equal(restarted.getJob('job-retry-identity')?.settlementTransactionHash, settlementHash);
    assert.equal(restarted.getJobBySource(11155111, candidate.sourceTransactionHash)?.jobId, 'job-retry-identity');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('terminal submission failures clear stale uncertainty phase markers', async () => {
  const candidate = {
    ...job('job-terminal-submission-phase'),
    state: 'SUBMITTING' as const,
    productState: 'SUBMITTING' as const,
    submissionUncertainty: true,
    submissionPhase: 'SETTLEMENT' as const,
    nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const fake: any = {
    config: { maxAttempts: 3 },
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch }),
  };
  const result = await (WorkerRuntime.prototype as any).failOrRetry.call(fake, candidate, new Error('wrongrules: policy rules hash mismatch'), 'settlement submission failed');
  assert.equal(result.state, 'VERIFICATION_FAILED');
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.submissionUncertainty, false);
  assert.equal(result.submissionPhase, undefined);
  assert.equal(result.nextRetryAt, null);
});

test('explicit payout phase wins over a stale public state during uncertainty recovery', async () => {
  const candidate = {
    ...job('job-explicit-payout-phase'),
    state: 'SETTLEMENT_PENDING' as const,
    productState: 'SETTLEMENT_PENDING' as const,
    submissionUncertainty: true,
    submissionPhase: 'PAYOUT' as const,
  };
  const fake: any = {
    reconcileExistingState: async () => ({ ...candidate, state: 'UNKNOWN', productState: 'UNKNOWN' }),
    destinationProvider: { getBlockNumber: async () => 100 },
    readPolicy: async () => { throw new Error('payout policy read unavailable'); },
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch }),
  };
  const result = await (WorkerRuntime.prototype as any).recoverUncertainSubmission.call(fake, candidate);
  assert.equal(result.state, 'PAYOUT_PENDING');
  assert.equal(result.productState, 'PAYOUT_PENDING');
  assert.equal(result.submissionPhase, 'PAYOUT');
  assert.equal(result.submissionUncertainty, true);
});

test('malformed settlement receipt status remains UNKNOWN', async () => {
  const candidate = {
    ...job('job-malformed-settlement-status'),
    state: 'SETTLEMENT_PENDING' as const,
    productState: 'SETTLEMENT_PENDING' as const,
    settlementTransactionHash: `0x${'f'.repeat(64)}`,
    submissionPhase: 'SETTLEMENT' as const,
  };
  const fake: any = {
    config: { asc: `0x${'a'.repeat(40)}` },
    destinationProvider: { getTransactionReceipt: async () => ({ status: null }) },
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch }),
  };
  const result = await (WorkerRuntime.prototype as any).reconcileSettlement.call(fake, candidate, null);
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.outcome, 'UNKNOWN');
  assert.equal(result.lastErrorClass, 'UNKNOWN');
  assert.equal(result.submissionPhase, 'SETTLEMENT');
  assert.equal(result.settlementReceiptStatus, null);
});

test('malformed payout receipt status remains UNKNOWN', async () => {
  const settlementHash = `0x${'a'.repeat(64)}`;
  const payoutHash = `0x${'b'.repeat(64)}`;
  const candidate = {
    ...job('job-malformed-payout-status'),
    state: 'PAYOUT_PENDING' as const,
    productState: 'PAYOUT_PENDING' as const,
    settlementTransactionHash: settlementHash,
    settlementReceiptStatus: 1,
    resultVerified: true,
    tournamentSettled: true,
    payoutTransactionHash: payoutHash,
    submissionPhase: 'PAYOUT' as const,
  };
  const fake: any = {
    reconcileExistingState: async () => ({ ...candidate, state: 'SETTLEMENT_COMPLETE', productState: 'CLAIMABLE' }),
    hasBoundSettlementEvidence: (WorkerRuntime.prototype as any).hasBoundSettlementEvidence,
    destinationProvider: { getTransactionReceipt: async () => ({ status: '0' }) },
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch }),
  };
  const result = await (WorkerRuntime.prototype as any).reconcilePayout.call(fake, candidate);
  assert.equal(result.state, 'PAYOUT_PENDING');
  assert.equal(result.outcome, 'UNKNOWN');
  assert.equal(result.lastErrorClass, 'UNKNOWN');
  assert.equal(result.submissionPhase, 'PAYOUT');
  assert.equal(result.payoutReceiptStatus, null);
});

function apiConfig(dataDirectory: string): any {
  return {
    root: process.cwd(), sourceRpc: 'http://127.0.0.1:1', destinationRpc: 'http://127.0.0.1:1', proverUrl: 'http://127.0.0.1:1',
    sourceChainId: 11155111, destinationChainId: 102031, sourceChainKey: 1,
    sourceRegistry: `0x${'2'.repeat(40)}`, sourceFinalizer: `0x${'5'.repeat(40)}`,
    sourceDeploymentBlock: 1, sourceStartBlock: 1, destinationDeploymentBlock: 1,
    token: `0x${'8'.repeat(40)}`, vault: `0x${'9'.repeat(40)}`, asc: `0x${'a'.repeat(40)}`,
    expectedBlockProver: `0x${'b'.repeat(40)}`, expectedChainInfo: `0x${'c'.repeat(40)}`,
    workerPrivateKey: undefined, autoClaim: false, confirmations: 1, batchSize: 10,
    pollIntervalMs: 100, maxAttempts: 2, leaseTtlMs: 1_000, reorgRewind: 1,
    dataDirectory, sourceExplorer: 'https://source', destinationExplorer: 'https://destination',
    deploymentFile: 'evidence/current-deployment.json',
    manifest: {
      protocolVersion: 'post-fix-v2',
      source: { chainId: 11155111, chainKey: 1, contract: `0x${'2'.repeat(40)}`, deployer: `0x${'5'.repeat(40)}`, rulesHash: `0x${'7'.repeat(64)}` },
      destination: {
        chainId: 102031, deployer: `0x${'5'.repeat(40)}`,
        token: { address: `0x${'8'.repeat(40)}`, deploymentBlock: 1 },
        vault: { address: `0x${'9'.repeat(40)}`, deploymentBlock: 1 },
        asc: { address: `0x${'a'.repeat(40)}`, deploymentBlock: 1 },
        expectedBlockProver: `0x${'b'.repeat(40)}`, expectedChainInfo: `0x${'c'.repeat(40)}`,
      },
    },
  };
}

test('API turns malformed percent-encoding into a sanitized 400', async () => {
  const config = apiConfig('/tmp/prizerail-api-invalid-uri');
  const runtime: any = {
    config,
    getConfigurationCheck: () => ({ outcome: 'PASS' }),
    store: { refresh: async () => undefined, getJobByTournament: () => undefined },
    vault: { policies: async () => ({ organizer: `0x${'0'.repeat(40)}` }) },
    destinationProvider: { getBlock: async () => ({ timestamp: 1 }) },
  };
  const api = new PrizeRailApi(runtime, config);
  const response = await (api as any).route('GET', '/api/v1/tournaments/%E0%A4%A/status');
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_INPUT');
});

test('API rejects malformed proof-job identifiers before lookup', async () => {
  const config = apiConfig('/tmp/prizerail-api-invalid-job');
  const runtime: any = {
    config,
    getConfigurationCheck: () => ({ outcome: 'PASS' }),
    store: { refresh: async () => undefined, getJob: () => undefined },
  };
  const api = new PrizeRailApi(runtime, config);
  const response = await (api as any).route('GET', '/api/v1/proof-jobs/not-a-job-id');
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_INPUT');
});

test('API explorer links require the exact configured host/path and no credentials', () => {
  const config = apiConfig('/tmp/prizerail-api-explorer-links');
  const sourceHash = `0x${'1'.repeat(64)}`;
  const baseJob = job('job-explorer-links');
  const withLink = (source: string): WorkerJob => ({
    ...baseJob,
    sourceTransactionHash: sourceHash,
    explorerLinks: { source, settlement: null, payout: null, replay: null, recovery: null },
  });

  const valid = envelope(withLink(`https://source/tx/${sourceHash}`), undefined, config);
  assert.equal(valid.explorerLinks.source, `https://source/tx/${sourceHash}`);

  const siblingPath = envelope(withLink(`https://source/txevil/${sourceHash}`), undefined, config);
  assert.equal(siblingPath.explorerLinks.source, null);

  const credentialed = envelope(withLink(`https://user:password@source/tx/${sourceHash}`), undefined, config);
  assert.equal(credentialed.explorerLinks.source, null);
});

test('API preserves UNKNOWN when a live policy read is unavailable', async () => {
  const config = apiConfig('/tmp/prizerail-api-policy-outage');
  const runtime: any = {
    config,
    getConfigurationCheck: () => ({ outcome: 'PASS' }),
    store: { refresh: async () => undefined, getJobByTournament: () => undefined },
    vault: { policies: async () => { throw new Error('socket timeout while reading policy'); } },
    destinationProvider: { getBlock: async () => ({ timestamp: 1 }) },
  };
  const api = new PrizeRailApi(runtime, config);
  const response = await (api as any).route('GET', `/api/v1/tournaments/0x${'1'.repeat(64)}/status`);
  assert.equal(response.status, 503);
  assert.equal(response.body.outcome, 'UNKNOWN');
  assert.equal(response.body.productState, 'INFRASTRUCTURE_UNAVAILABLE');
  assert.equal(response.body.error.class, 'RPC_UNAVAILABLE');
});

test('proof-job API downgrades on policy outage and externally advanced policy state', async () => {
  const config = apiConfig('/tmp/prizerail-api-proof-policy');
  const candidate = {
    ...job(`job-${'d'.repeat(24)}`),
    state: 'CLAIMABLE' as const,
    productState: 'CLAIMABLE' as const,
    policyState: 2,
  };
  const fundedPolicy = {
    organizer: `0x${'4'.repeat(40)}`, sourceChainKey: 1, sourceRegistry: config.sourceRegistry,
    rulesHash: candidate.rulesHash, token: config.token, amount: '1', settlementDeadline: 200,
    refundDeadline: 300, winner: candidate.winner, resultNonce: candidate.resultNonce,
    sourceQueryKey: `0x${'6'.repeat(64)}`, state: 2,
  };
  const store = {
    refresh: async () => undefined,
    getJob: () => candidate,
    getTransitions: () => [],
  };
  const runtime: any = {
    config,
    getConfigurationCheck: () => ({ outcome: 'PASS' }),
    store,
    vault: { policies: async () => fundedPolicy },
    destinationProvider: { getBlock: async () => ({ timestamp: 1 }) },
  };
  const api = new PrizeRailApi(runtime, config);
  const advanced = {
    ...fundedPolicy,
    state: 3,
  };
  runtime.vault.policies = async () => advanced;
  let response = await (api as any).route('GET', `/api/v1/proof-jobs/${candidate.jobId}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.policyState, 'CLAIMED');
  assert.equal(response.body.productState, 'UNKNOWN');
  assert.equal(response.body.outcome, 'UNKNOWN');
  assert.equal(response.body.error.class, 'INCONSISTENT_CLAIM_EVIDENCE');
  runtime.vault.policies = async () => { throw new Error('socket timeout while reading policy'); };
  response = await (api as any).route('GET', `/api/v1/proof-jobs/${candidate.jobId}`);
  assert.equal(response.status, 503);
  assert.equal(response.body.outcome, 'UNKNOWN');
  assert.equal(response.body.productState, 'INFRASTRUCTURE_UNAVAILABLE');
  assert.equal(response.body.error.class, 'RPC_UNAVAILABLE');
});

test('proof-job API does not project stale success when the fresh policy is absent', async () => {
  const config = apiConfig('/tmp/prizerail-api-proof-absent');
  const candidate = {
    ...job(`job-${'e'.repeat(24)}`),
    state: 'CLAIMED' as const,
    productState: 'CLAIMED' as const,
    outcome: 'PASS' as const,
    policyState: 3,
    settlementTransactionHash: `0x${'a'.repeat(64)}`,
    settlementReceiptStatus: 1,
    resultVerified: true,
    tournamentSettled: true,
    payoutTransactionHash: `0x${'b'.repeat(64)}`,
    payoutReceiptStatus: 1,
    prizeClaimed: true,
  };
  const runtime: any = {
    config,
    getConfigurationCheck: () => ({ outcome: 'PASS' }),
    store: { refresh: async () => undefined, getJob: () => candidate, getTransitions: () => [] },
    vault: { policies: async () => ({ organizer: `0x${'0'.repeat(40)}`, state: 0 }) },
    destinationProvider: { getBlock: async () => ({ timestamp: 1 }) },
  };
  const api = new PrizeRailApi(runtime, config);
  const response = await (api as any).route('GET', `/api/v1/proof-jobs/${candidate.jobId}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.policyState, null);
  assert.equal(response.body.productState, 'UNKNOWN');
  assert.equal(response.body.outcome, 'UNKNOWN');
  assert.equal(response.body.error.class, 'POLICY_NOT_FOUND');
});

test('API does not claim a fresh CLAIMED policy without matching payout evidence', async () => {
  const config = apiConfig('/tmp/prizerail-api-stale-claim');
  const candidate = job('job-stale-claim');
  const claimedPolicy = {
    organizer: `0x${'4'.repeat(40)}`, sourceChainKey: 1, sourceRegistry: config.sourceRegistry,
    rulesHash: candidate.rulesHash, token: config.token, amount: '1', settlementDeadline: 200,
    refundDeadline: 300, winner: candidate.winner, resultNonce: candidate.resultNonce,
    sourceQueryKey: `0x${'6'.repeat(64)}`, state: 3,
  };
  const stale = { ...candidate, state: 'CLAIMABLE' as const, productState: 'CLAIMABLE' as const, policyState: 2 };
  const runtime: any = {
    config,
    getConfigurationCheck: () => ({ outcome: 'PASS' }),
    store: {
      refresh: async () => undefined,
      getJobByTournament: () => stale,
      getTransitions: () => [],
    },
    vault: { policies: async () => claimedPolicy },
    destinationProvider: { getBlock: async () => ({ timestamp: 1 }) },
  };
  const api = new PrizeRailApi(runtime, config);
  const response = await (api as any).route('GET', `/api/v1/tournaments/${candidate.tournamentId}/status`);
  assert.equal(response.status, 200);
  assert.equal(response.body.policyState, 'CLAIMED');
  assert.equal(response.body.productState, 'UNKNOWN');
  assert.equal(response.body.outcome, 'UNKNOWN');
  assert.equal(response.body.error.class, 'INCONSISTENT_CLAIM_EVIDENCE');
});

test('API preserves a terminal semantic job failure when policy is still funded', async () => {
  const config = apiConfig('/tmp/prizerail-api-terminal-job');
  const candidate = { ...job('job-terminal-state'), state: 'VERIFICATION_FAILED' as const, productState: 'VERIFICATION_FAILED' as const, outcome: 'FAIL' as const, evidenceOutcome: 'FAIL' as const, lastErrorClass: 'WRONG_RULES' as const, lastErrorMessage: 'rules mismatch', policyState: 1 };
  const fundedPolicy = {
    organizer: `0x${'4'.repeat(40)}`, sourceChainKey: 1, sourceRegistry: config.sourceRegistry,
    rulesHash: candidate.rulesHash, token: config.token, amount: '1', settlementDeadline: 200,
    refundDeadline: 300, winner: candidate.winner, resultNonce: candidate.resultNonce,
    sourceQueryKey: `0x${'0'.repeat(64)}`, state: 1,
  };
  const runtime: any = {
    config,
    getConfigurationCheck: () => ({ outcome: 'PASS' }),
    store: { refresh: async () => undefined, getJobByTournament: () => candidate, getTransitions: () => [] },
    vault: { policies: async () => fundedPolicy },
    destinationProvider: { getBlock: async () => ({ timestamp: 1 }) },
  };
  const api = new PrizeRailApi(runtime, config);
  const response = await (api as any).route('GET', `/api/v1/tournaments/${candidate.tournamentId}/status`);
  assert.equal(response.status, 200);
  assert.equal(response.body.policyState, 'FUNDED');
  assert.equal(response.body.productState, 'VERIFICATION_FAILED');
  assert.equal(response.body.outcome, 'FAIL');
  assert.equal(response.body.error.class, 'WRONG_RULES');
});

test('durable store fences leases and rejects duplicate transaction identities', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-store-fence-'));
  try {
    const store = await DurableStore.open(directory, 1);
    const first = job('job-identity-a');
    await store.saveJob(first, 'seed');
    await store.claimLease(first.jobId, 'owner-a', 2_000);
    await assert.rejects(
      store.saveJob({ ...first, state: 'PROOF_READY', productState: 'PROOF_READY' }, 'stale owner write', 'owner-b'),
      /LEASE_LOST/,
    );
    const committed = { ...first, settlementTransactionHash: `0x${'a'.repeat(64)}` };
    await store.saveJob(committed, 'settlement identity');
    const second = {
      ...job('job-identity-b'),
      sourceTransactionHash: `0x${'9'.repeat(64)}`,
      tournamentId: `0x${'8'.repeat(64)}`,
      resultNonce: '9',
      settlementTransactionHash: committed.settlementTransactionHash,
    };
    await assert.rejects(store.saveJob(second, 'duplicate settlement identity'), /uniqueness conflict|index collision/);
    await assert.rejects(
      store.saveJob({ ...first, sourceTransactionHash: `0x${'e'.repeat(64)}` }, 'mutable source identity'),
      /immutable|identity|uniqueness/i,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('durable store fails closed on replayed index collisions', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'prizerail-store-corrupt-'));
  try {
    const store = await DurableStore.open(directory, 1);
    const first = job('job-corrupt-a');
    await store.saveJob(first, 'seed');
    const conflicting = {
      ...job('job-corrupt-b'),
      sourceTransactionHash: first.sourceTransactionHash,
      tournamentId: `0x${'8'.repeat(64)}`,
      resultNonce: '9',
    };
    await fs.appendFile(store.journalPath, `${JSON.stringify({ op: 'job', job: conflicting })}\n`);
    await assert.rejects(DurableStore.open(directory, 1), /index collision/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('settlement and payout evidence is bound to the durable job predicates', () => {
  const candidate = job('job-event-binding');
  const config: any = apiConfig('/tmp/prizerail-event-binding');
  const sourceQueryKey = `0x${'9'.repeat(64)}`;
  const businessKey = keccak256(AbiCoder.defaultAbiCoder().encode(
    ['uint64', 'address', 'bytes32', 'uint256'],
    [candidate.sourceChainKey, config.sourceRegistry, candidate.tournamentId, candidate.resultNonce],
  ));
  const ascInterface = new Interface(ASC_ABI);
  const vaultInterface = new Interface(VAULT_ABI);
  const resultVerified = ascInterface.encodeEventLog(ascInterface.getEvent('ResultVerified')!, [candidate.tournamentId, businessKey, sourceQueryKey, candidate.winner, candidate.resultNonce]);
  const tournamentSettled = vaultInterface.encodeEventLog(vaultInterface.getEvent('TournamentSettled')!, [candidate.tournamentId, candidate.winner, candidate.resultNonce, sourceQueryKey]);
  const prizeClaimed = vaultInterface.encodeEventLog(vaultInterface.getEvent('PrizeClaimed')!, [candidate.tournamentId, candidate.winner, '1']);
  const settlementReceipt = {
    status: 1,
    hash: candidate.settlementTransactionHash ?? `0x${'a'.repeat(64)}`,
    to: config.asc,
    logs: [
      { address: config.asc, topics: resultVerified.topics, data: resultVerified.data },
      { address: config.vault, topics: tournamentSettled.topics, data: tournamentSettled.data },
    ],
  };
  const payoutReceipt = {
    status: 1,
    hash: candidate.payoutTransactionHash ?? `0x${'b'.repeat(64)}`,
    to: config.vault,
    logs: [{ address: config.vault, topics: prizeClaimed.topics, data: prizeClaimed.data }],
  };
  const fake: any = {
    config,
    expectedBusinessKey: (value: WorkerJob) => businessKey,
    policyMatchesJob: (WorkerRuntime.prototype as any).policyMatchesJob,
    receiptMatchesTarget: (WorkerRuntime.prototype as any).receiptMatchesTarget,
    parsedReceiptEvent: (WorkerRuntime.prototype as any).parsedReceiptEvent,
    eventValue: (WorkerRuntime.prototype as any).eventValue,
  };
  const policy: any = {
    sourceChainKey: candidate.sourceChainKey,
    sourceRegistry: candidate.sourceRegistry,
    rulesHash: candidate.rulesHash,
    token: config.token,
    sourceQueryKey,
    winner: candidate.winner,
    resultNonce: candidate.resultNonce,
    amount: '1',
  };
  const settlement = (WorkerRuntime.prototype as any).settlementEvidence.call(fake, settlementReceipt, candidate, policy, sourceQueryKey);
  assert.deepEqual(settlement, { resultVerified: true, tournamentSettled: true });
  const payout = (WorkerRuntime.prototype as any).payoutEvidence.call(fake, payoutReceipt, candidate, policy);
  assert.equal(payout, true);
  const wrongWinner = { ...candidate, winner: `0x${'6'.repeat(40)}` };
  const rejectedSettlement = (WorkerRuntime.prototype as any).settlementEvidence.call(fake, settlementReceipt, wrongWinner, policy, sourceQueryKey);
  assert.deepEqual(rejectedSettlement, { resultVerified: false, tournamentSettled: false });
  const wrongAmount = (WorkerRuntime.prototype as any).payoutEvidence.call(fake, payoutReceipt, candidate, { ...policy, amount: '2' });
  assert.equal(wrongAmount, false);
});

function reconciliationRuntime(config: any, policy: Record<string, unknown>, settledLogs: any[] = [], claimLogs: any[] = [], receipts: Record<string, any> = {}): any {
  const runtime: any = new (WorkerRuntime as any)(config, {});
  runtime.save = async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch });
  runtime.destinationProvider = {
    getBlockNumber: async () => 1000,
    getTransactionReceipt: async (hash: string) => receipts[hash.toLowerCase()] ?? null,
    getBlock: async () => null,
  };
  runtime.vault = {
    policies: async () => policy,
    filters: { PrizeClaimed: () => ({ event: 'PrizeClaimed' }) },
    queryFilter: async () => claimLogs,
  };
  runtime.asc = {
    filters: { ResultVerified: () => ({ event: 'ResultVerified' }) },
    queryFilter: async () => settledLogs,
  };
  return runtime;
}

function settledPolicy(config: any, candidate: WorkerJob, state = 2, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organizer: `0x${'4'.repeat(40)}`,
    sourceChainKey: 1,
    sourceRegistry: config.sourceRegistry,
    rulesHash: candidate.rulesHash,
    token: config.token,
    amount: '1',
    settlementDeadline: 200,
    refundDeadline: 300,
    winner: candidate.winner,
    resultNonce: candidate.resultNonce,
    sourceQueryKey: `0x${'9'.repeat(64)}`,
    state,
    ...overrides,
  };
}

test('reconciliation keeps a submitted settlement hash pending when receipt evidence is unbound', async () => {
  const config = apiConfig('/tmp/prizerail-reconcile-unbound-settlement');
  const settlementHash = `0x${'a'.repeat(64)}`;
  const candidate = { ...job('job-reconcile-unbound'), state: 'SETTLEMENT_PENDING' as const, productState: 'SETTLEMENT_PENDING' as const, policyState: 2, settlementTransactionHash: settlementHash };
  const runtime = reconciliationRuntime(config, settledPolicy(config, candidate), [], [], {
    [settlementHash]: { status: 1, hash: settlementHash, to: config.asc, logs: [] },
  });
  const result = await (WorkerRuntime.prototype as any).reconcileExistingState.call(runtime, candidate);
  assert.equal(result.state, 'SETTLEMENT_PENDING');
  assert.equal(result.outcome, 'UNKNOWN');
  assert.equal(result.settlementTransactionHash, settlementHash);
  assert.equal(result.resultVerified, null);
  assert.equal(result.tournamentSettled, null);
});

test('uncertain payout recovery does not claim when settlement evidence is missing', async () => {
  const config = apiConfig('/tmp/prizerail-reconcile-unbound-payout');
  const candidate = { ...job('job-reconcile-unbound-payout'), state: 'PAYOUT_PENDING' as const, productState: 'PAYOUT_PENDING' as const, policyState: 3, submissionUncertainty: true };
  const policy = settledPolicy(config, candidate, 3);
  const vaultInterface = new Interface(VAULT_ABI);
  const event = vaultInterface.encodeEventLog(vaultInterface.getEvent('PrizeClaimed')!, [candidate.tournamentId, candidate.winner, '1']);
  const payoutHash = `0x${'b'.repeat(64)}`;
  const claim = {
    transactionHash: payoutHash,
    getTransactionReceipt: async () => ({ status: 1, hash: payoutHash, to: config.vault, logs: [{ address: config.vault, topics: event.topics, data: event.data }] }),
  };
  const runtime = reconciliationRuntime(config, policy, [], [claim], {});
  const result = await (WorkerRuntime.prototype as any).recoverUncertainSubmission.call(runtime, candidate);
  assert.equal(result.state, 'PAYOUT_PENDING');
  assert.equal(result.outcome, 'UNKNOWN');
  assert.equal(result.prizeClaimed, true);
  assert.equal(result.payoutTransactionHash, payoutHash);
  assert.equal(result.submissionUncertainty, true);
});

test('uncertain payout recovery remains waiting when the fresh policy is absent', async () => {
  const candidate = { ...job('job-uncertain-payout-absent'), state: 'PAYOUT_PENDING' as const, productState: 'PAYOUT_PENDING' as const, submissionUncertainty: true };
  let policyReads = 0;
  const fake: any = {
    reconcileExistingState: async () => ({
      ...candidate,
      state: 'WAITING_FOR_POLICY',
      productState: 'WAITING_FOR_POLICY',
      outcome: 'UNKNOWN',
      policyState: 0,
      lastErrorClass: 'POLICY_NOT_FOUND',
      lastErrorMessage: 'matching CC3 policy is not present on the destination chain',
    }),
    readPolicy: async () => { policyReads += 1; throw new Error('must not read stale policy after explicit wait'); },
    save: async (value: WorkerJob, _reason: string, patch: Partial<WorkerJob> = {}) => ({ ...value, ...patch }),
  };
  const result = await (WorkerRuntime.prototype as any).recoverUncertainSubmission.call(fake, candidate);
  assert.equal(result.state, 'WAITING_FOR_POLICY');
  assert.equal(result.outcome, 'UNKNOWN');
  assert.equal(result.submissionUncertainty, true);
  assert.equal(policyReads, 0);
});

test('admission and reconciliation fail closed on malformed or mismatched policy predicates', async () => {
  const config = apiConfig('/tmp/prizerail-reconcile-malformed-policy');
  const store: any = { saveJob: async () => undefined };
  const runtime: any = new (WorkerRuntime as any)(config, store);
  runtime.destinationProvider = { getBlock: async () => ({ timestamp: 100 }) };
  runtime.asc = { usedBusinessResults: async () => false };
  const candidate = job('job-reconcile-malformed-policy');
  runtime.vault = { policies: async () => settledPolicy(config, candidate, 2, { sourceQueryKey: `0x${'0'.repeat(64)}` }) };
  const admitted = await runtime.admit(candidate);
  assert.equal(admitted.kind, 'PERMANENT_FAILURE');
  assert.equal((admitted as any).errorClass, 'INVALID_INPUT');

  const mismatch = settledPolicy(config, candidate, 2, { sourceRegistry: `0x${'d'.repeat(40)}` });
  const reconciling = reconciliationRuntime(config, mismatch);
  const reconciled = await (WorkerRuntime.prototype as any).reconcileExistingState.call(reconciling, { ...candidate, state: 'SETTLEMENT_COMPLETE', productState: 'CLAIMABLE', policyState: 2 });
  assert.equal(reconciled.state, 'VERIFICATION_FAILED');
  assert.equal(reconciled.outcome, 'FAIL');
  assert.equal(reconciled.lastErrorClass, 'WRONG_SOURCE_REGISTRY');
});

test('reconciliation resolves refunded and hashless funded policies without event-log availability', async () => {
  const config = apiConfig('/tmp/prizerail-reconcile-policy-shortcuts');
  const refundedCandidate = {
    ...job('job-reconcile-refunded-shortcut'),
    state: 'CLAIMABLE' as const,
    productState: 'CLAIMABLE' as const,
    settlementReceiptStatus: 1,
    resultVerified: true,
    tournamentSettled: true,
    payoutReceiptStatus: 1,
    prizeClaimed: true,
  };
  const fundedCandidate = {
    ...job('job-reconcile-funded-shortcut'),
    state: 'CLAIMED' as const,
    productState: 'CLAIMED' as const,
    outcome: 'PASS' as const,
    evidenceOutcome: 'PASS' as const,
    settlementReceiptStatus: 1,
    resultVerified: true,
    tournamentSettled: true,
    payoutReceiptStatus: 1,
    prizeClaimed: true,
  };
  const refundedPolicy = settledPolicy(config, refundedCandidate, 4);
  const fundedPolicy = settledPolicy(config, fundedCandidate, 1, {
    winner: `0x${'0'.repeat(40)}`,
    resultNonce: '0',
    sourceQueryKey: `0x${'0'.repeat(64)}`,
  });
  const makeRuntime = (policy: Record<string, unknown>) => {
    const runtime = reconciliationRuntime(config, policy);
    let queryCalls = 0;
    runtime.asc.queryFilter = async () => { queryCalls += 1; throw new Error('event index unavailable'); };
    runtime.vault.queryFilter = async () => { queryCalls += 1; throw new Error('event index unavailable'); };
    return { runtime, queryCalls: () => queryCalls };
  };

  const refunded = makeRuntime(refundedPolicy);
  const refundedResult = await (WorkerRuntime.prototype as any).reconcileExistingState.call(refunded.runtime, refundedCandidate);
  assert.equal(refundedResult.state, 'REFUNDED');
  assert.equal(refundedResult.outcome, 'PASS');
  assert.equal(refundedResult.policyState, 4);
  assert.equal(refundedResult.settlementReceiptStatus, null);
  assert.equal(refundedResult.payoutReceiptStatus, null);
  assert.equal(refunded.queryCalls(), 0);

  const funded = makeRuntime(fundedPolicy);
  const fundedResult = await (WorkerRuntime.prototype as any).reconcileExistingState.call(funded.runtime, fundedCandidate);
  assert.equal(fundedResult.state, 'MINED');
  assert.equal(fundedResult.productState, 'MINED');
  assert.equal(fundedResult.outcome, 'PASS');
  assert.equal(fundedResult.policyState, 1);
  assert.equal(fundedResult.settlementReceiptStatus, null);
  assert.equal(fundedResult.payoutReceiptStatus, null);
  assert.equal(funded.queryCalls(), 0);
});

test('source admission validation runs before a destination policy outage', async () => {
  const config = apiConfig('/tmp/prizerail-source-first-admission');
  const candidate = { ...job('job-source-first-admission'), sourceReceiptStatus: null };
  let policyReads = 0;
  const runtime: any = new (WorkerRuntime as any)(config, {});
  runtime.vault = { policies: async () => { policyReads += 1; throw new Error('destination RPC unavailable'); } };
  const result = await runtime.admit(candidate);
  assert.equal(result.kind, 'PERMANENT_FAILURE');
  assert.equal((result as any).errorClass, 'SOURCE_FAILED');
  assert.equal(policyReads, 0);
});

test('non-payable draw admission runs before a destination policy outage', async () => {
  const config = apiConfig('/tmp/prizerail-draw-first-admission');
  const candidate = { ...job('job-draw-first-admission'), result: 0, winner: `0x${'0'.repeat(40)}` };
  let policyReads = 0;
  const runtime: any = new (WorkerRuntime as any)(config, {});
  runtime.vault = { policies: async () => { policyReads += 1; throw new Error('destination RPC unavailable'); } };
  const result = await runtime.admit(candidate);
  assert.equal(result.kind, 'NON_PAYABLE_RESULT');
  assert.equal(policyReads, 0);
});
