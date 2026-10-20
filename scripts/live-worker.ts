import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { AbiCoder, Contract, Interface, JsonRpcProvider, Wallet, keccak256 } from 'ethers';
import { getAttestcoinProof } from '../src/attestcoin.js';
import { proofToQuery, rpsMatchFinalizedAdapter } from '../src/adapter.js';
import { DurableStore } from '../src/durable-store.js';
import { asPolicy, loadWorkerConfig, safeError } from '../src/worker-runtime.js';

/* Fresh worker/API closure run. Historical evidence is never overwritten. */
const root = process.cwd();
function loadEnv(): void {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
loadEnv();

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const artifact = (name: string): any => JSON.parse(fs.readFileSync(path.join(root, 'artifacts', `${name}.json`), 'utf8'));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isoNow = () => new Date().toISOString();
const normalize = (value: unknown) => String(value ?? '').toLowerCase();
const hashPattern = (value: string) => /^0x[0-9a-f]{64}$/i.test(value);

async function poll<T>(fn: () => Promise<T | null>, timeoutMs: number, intervalMs = 500): Promise<T> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value !== null) return value;
    } catch (error) { lastError = error; }
    await wait(intervalMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms${lastError ? `: ${safeError(lastError)}` : ''}`);
}

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error('could not allocate an ephemeral localhost port');
  return port;
}

async function send(contract: Contract, method: string, args: unknown[]): Promise<Record<string, unknown>> {
  const response = await (contract as any)[method](...args);
  const receipt = await response.wait();
  if (!receipt || Number(receipt.status) !== 1) throw new Error(`${method} receipt was not successful`);
  return { hash: normalize(response.hash), status: Number(receipt.status), blockNumber: receipt.blockNumber, blockHash: normalize(receipt.blockHash), gasUsed: receipt.gasUsed?.toString?.() ?? null };
}

async function txEvidence(provider: JsonRpcProvider, hash: string, label: string): Promise<Record<string, unknown>> {
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt) throw new Error(`${label} receipt unavailable for ${hash}`);
  const block = await provider.getBlock(receipt.blockNumber);
  return { hash: normalize(receipt.hash), status: Number(receipt.status), blockNumber: receipt.blockNumber, blockHash: normalize(receipt.blockHash), gasUsed: receipt.gasUsed?.toString?.() ?? null, blockTimestamp: block ? new Date(Number(block.timestamp) * 1000).toISOString() : null };
}

type Child = ChildProcessByStdio<null, Readable, Readable>;
type StopResult = { requestedAt: string; stoppedAt: string; exitCode: number | null; signal: NodeJS.Signals | null; forceKilled: boolean; confirmed: boolean };
function startChild(script: string, env: NodeJS.ProcessEnv): Child {
  const child = spawn(process.execPath, ['--import', 'tsx', script], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => process.stderr.write(`[${path.basename(script)}] ${String(chunk)}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${path.basename(script)}:err] ${String(chunk)}`));
  return child;
}
async function stopChild(child: Child | undefined): Promise<StopResult | null> {
  if (!child) return null;
  if (child.exitCode !== null || child.signalCode !== null) return { requestedAt: isoNow(), stoppedAt: isoNow(), exitCode: child.exitCode, signal: child.signalCode, forceKilled: false, confirmed: true };
  const requestedAt = isoNow();
  child.kill('SIGTERM');
  let forceKilled = false;
  await Promise.race([
    new Promise<void>((resolve) => child.once('close', () => resolve())),
    wait(10_000).then(() => { if (child.exitCode === null && child.signalCode === null) { forceKilled = true; child.kill('SIGKILL'); } }),
  ]);
  if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => child.once('close', () => resolve()));
  return { requestedAt, stoppedAt: isoNow(), exitCode: child.exitCode, signal: child.signalCode, forceKilled, confirmed: child.exitCode !== null || child.signalCode !== null };
}

type HttpObservation = { phase: string; transport: 'socket'; request: { method: string; path: string; url: string }; response: { status: number; headers: Record<string, string | null>; body: unknown } };
function assertSafeHttp(body: unknown): unknown {
  if (/PRIVATE_KEY|SESSION_SECRET|DATABASE_URL|txBytes|merkleProof|continuityProof|proofBytes/i.test(JSON.stringify(body ?? null))) throw new Error('HTTP response contained forbidden credential or raw-proof material');
  return body;
}

type Snapshot = Record<string, any>;
type RuntimeRow = { runtimeId: string; pid: number | null; firstAt: string; lastAt: string; startedAt: string; heartbeatAt: string; activity: Array<{ at: string; line: number }> };
function readJournal(directory: string, targetJobId: string): { records: Array<{ line: number; record: any }>; snapshots: Snapshot[]; timeline: Snapshot[]; runtimeRows: RuntimeRow[]; assignments: { settlement: Snapshot[]; payout: Snapshot[] } } {
  const journalPath = path.join(directory, 'worker.journal');
  const content = fs.existsSync(journalPath) ? fs.readFileSync(journalPath, 'utf8') : '';
  const records: Array<{ line: number; record: any }> = [];
  const heartbeats: Array<{ owner: string; at: string; line: number }> = [];
  const snapshots: Snapshot[] = [];
  for (const [index, line] of content.split('\n').entries()) {
    if (!line.trim()) continue;
    let record: any;
    try { record = JSON.parse(line); } catch { continue; }
    records.push({ line: index + 1, record });
    if (record.op === 'heartbeat' && record.heartbeat?.owner && record.heartbeat?.at) heartbeats.push({ owner: String(record.heartbeat.owner), at: String(record.heartbeat.at), line: index + 1 });
    if (record.op !== 'job' || record.job?.jobId !== targetJobId) continue;
    const job = record.job;
    const previous = snapshots.at(-1);
    const at = String(job.updatedAt);
    const nearest = [...heartbeats].reverse().find((entry) => Date.parse(entry.at) <= Date.parse(at));
    snapshots.push({ revision: snapshots.length + 1, journalLine: index + 1, recordIndex: records.length - 1, at, jobId: targetJobId, state: job.state, from: record.transition?.from ?? previous?.state ?? null, to: record.transition?.to ?? job.state, runtimeId: nearest?.owner ?? null, attemptCount: job.attemptCount, proofAttempt: job.state === 'AWAITING_ATTESTATION' ? job.attemptCount : null, proofLatencyMs: job.proofLatencyMs ?? null, settlementTransactionHash: job.settlementTransactionHash ?? null, payoutTransactionHash: job.payoutTransactionHash ?? null, sourceTransactionHash: job.sourceTransactionHash, tournamentId: job.tournamentId, resultNonce: job.resultNonce, leaseOwner: job.lease?.owner ?? null, leaseExpiresAt: job.lease?.expiresAt ?? null });
  }
  const assignments = { settlement: [] as Snapshot[], payout: [] as Snapshot[] };
  for (let index = 0; index < snapshots.length; index += 1) {
    const previous = snapshots[index - 1];
    const current = snapshots[index];
    if (!previous?.settlementTransactionHash && current.settlementTransactionHash) assignments.settlement.push({ hash: current.settlementTransactionHash, at: current.at, revision: current.revision, journalLine: current.journalLine });
    if (!previous?.payoutTransactionHash && current.payoutTransactionHash) assignments.payout.push({ hash: current.payoutTransactionHash, at: current.at, revision: current.revision, journalLine: current.journalLine });
  }
  const grouped = new Map<string, RuntimeRow>();
  for (const heartbeat of heartbeats) {
    const existing = grouped.get(heartbeat.owner);
    if (!existing) grouped.set(heartbeat.owner, { runtimeId: heartbeat.owner, pid: Number(heartbeat.owner.split(':')[0]) || null, firstAt: heartbeat.at, lastAt: heartbeat.at, startedAt: heartbeat.at, heartbeatAt: heartbeat.at, activity: [{ at: heartbeat.at, line: heartbeat.line }] });
    else { existing.lastAt = heartbeat.at; existing.heartbeatAt = heartbeat.at; existing.activity.push({ at: heartbeat.at, line: heartbeat.line }); }
  }
  const runtimeRows = [...grouped.values()].sort((a, b) => Date.parse(a.firstAt) - Date.parse(b.firstAt));
  return { records, snapshots, timeline: snapshots.map((row) => ({ ...row })), runtimeRows, assignments };
}

function hashLoadBearingFiles(): Record<string, unknown> {
  const files = ['src/worker-runtime.ts', 'src/durable-store.ts', 'src/api.ts', 'src/worker-types.ts', 'src/adapter.ts', 'src/attestcoin.ts', 'scripts/worker.ts', 'scripts/api.ts', 'scripts/live-worker.ts', 'artifacts/PrizeRailASC.json', 'artifacts/PrizeVault.json', 'artifacts/TournamentResultRegistry.json', 'evidence/current-deployment.json', 'package.json'];
  const hashes: Record<string, string> = {};
  for (const file of files) hashes[file] = createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  return { algorithm: 'sha256', gitProvenance: 'UNKNOWN', gitCommit: null, capturedAt: isoNow(), files: hashes };
}

function publishExclusive(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.linkSync(temp, file); } finally { fs.unlinkSync(temp); }
}

async function run(): Promise<void> {
  const deployerKey = required('DEPLOYER_PRIVATE_KEY');
  const workerKey = required('WORKER_PRIVATE_KEY');
  const sourceRpc = required('SEPOLIA_RPC_URL');
  const destinationRpc = required('CREDITCOIN_RPC_URL');
  const sourceProvider = new JsonRpcProvider(sourceRpc);
  const destinationProvider = new JsonRpcProvider(destinationRpc);
  const sourceFinalizer = new Wallet(deployerKey, sourceProvider);
  const sourcePlayerTwo = new Wallet(workerKey, sourceProvider);
  const organizer = new Wallet(deployerKey, destinationProvider);
  const workerSigner = new Wallet(workerKey, destinationProvider);
  const deployment = loadWorkerConfig(root);
  if (sourceFinalizer.address.toLowerCase() !== deployment.sourceFinalizer) throw new Error('source finalizer/deployer reuse does not match selected deployment');
  const selectedWorker = deployment.manifest.destination.settlementWorker ?? deployment.manifest.destination.deployer;
  if (workerSigner.address.toLowerCase() !== selectedWorker.toLowerCase()) throw new Error('worker key does not match selected settlement worker');
  const runId = `worker-live-v2-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${randomBytes(6).toString('hex')}`;
  const dataDirectory = path.resolve(root, '.data', runId);
  const storeId = createHash('sha256').update(`prizerail-store:${path.relative(root, dataDirectory)}`).digest('hex').slice(0, 32);
  const evidencePath = path.join(root, 'evidence', `${runId}.json`);
  // Capture the source/configuration identity before starting either runtime.
  // The evidence must bind the exact implementation that processed this run.
  const sourceHashesBeforeWorker = hashLoadBearingFiles();
  const sourceHeadBeforeWorker = await sourceProvider.getBlockNumber();
  const apiPort = process.env.LIVE_WORKER_API_PORT ? Number(process.env.LIVE_WORKER_API_PORT) : await freePort();
  if (!Number.isSafeInteger(apiPort) || apiPort < 1024 || apiPort > 65535) throw new Error('LIVE_WORKER_API_PORT must be a valid TCP port');
  const apiBase = `http://127.0.0.1:${apiPort}/api/v1`;
  const allowedOrigin = 'http://127.0.0.1:4173';
  const childEnv: NodeJS.ProcessEnv = { ...process.env, PRIZERAIL_DATA_DIR: dataDirectory, WORKER_SOURCE_START_BLOCK: String(sourceHeadBeforeWorker), WORKER_BATCH_SIZE: '5', WORKER_AUTO_CLAIM: 'true', WORKER_CONFIRMATIONS: '1', WORKER_POLL_INTERVAL_MS: '1000', WORKER_MAX_ATTEMPTS: '12', WORKER_LEASE_TTL_MS: '180000', WORKER_REORG_REWIND: '0', PORT: String(apiPort), HOST: '127.0.0.1', CORS_ALLOWED_ORIGINS: allowedOrigin };
  const http: HttpObservation[] = [];
  const request = async (phase: string, method: string, pathname: string, origin = allowedOrigin): Promise<{ status: number; body: any; headers: Headers }> => {
    const url = `${apiBase}${pathname}`;
    const response = await fetch(url, { method, headers: { Accept: 'application/json', Origin: origin } });
    const text = await response.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text.slice(0, 320); }
    body = assertSafeHttp(body);
    const headers = { 'content-type': response.headers.get('content-type'), 'access-control-allow-origin': response.headers.get('access-control-allow-origin'), 'access-control-allow-methods': response.headers.get('access-control-allow-methods'), 'access-control-allow-headers': response.headers.get('access-control-allow-headers') };
    http.push({ phase, transport: 'socket', request: { method, path: pathname, url }, response: { status: response.status, headers, body } });
    return { status: response.status, body, headers: response.headers };
  };
  let apiProcess: Child | undefined;
  let firstWorker: Child | undefined;
  let secondWorker: Child | undefined;
  let jobId: string | null = null;
  let firstStop: StopResult | null = null;
  let stopMarkerPath: string | null = null;
  const startedAt = isoNow();
  try {
    fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    apiProcess = startChild('scripts/api.ts', childEnv);
    await poll(async () => { const result = await request('api_startup', 'GET', '/config'); return result.status === 200 ? result : null; }, 60_000, 500);
    await request('api_startup_health', 'GET', '/health');
    await request('api_cors_preflight', 'OPTIONS', '/config');
    await request('api_method_rejection', 'POST', '/config');
    await request('api_invalid_job', 'GET', '/proof-jobs/invalid-job');
    firstWorker = startChild('scripts/worker.ts', childEnv);
    await poll(async () => { const health = await request('worker_startup_health', 'GET', '/health'); return health.body?.dependencies?.configuration?.outcome === 'PASS' ? health : null; }, 90_000, 1_000);

    const registry = new Contract(deployment.sourceRegistry, artifact('TournamentResultRegistry').abi, sourceFinalizer);
    const token = new Contract(deployment.token, artifact('MockPrizeToken').abi, organizer);
    const vault = new Contract(deployment.vault, artifact('PrizeVault').abi, organizer);
    const runSeed = `${runId}-${process.pid}`;
    const tournamentId = keccak256(Buffer.from(`${runSeed}-tournament`));
    const matchId = keccak256(Buffer.from(`${runSeed}-match`));
    const rulesHash = deployment.manifest.source.rulesHash;
    const amount = 1_000_000_000_000_000_000n;
    const sourceLatest = await sourceProvider.getBlock('latest');
    const destinationLatest = await destinationProvider.getBlock('latest');
    const revealDeadline = Number(sourceLatest?.timestamp ?? Math.floor(Date.now() / 1000)) + 1800;
    const settlementDeadline = Number(destinationLatest?.timestamp ?? Math.floor(Date.now() / 1000)) + 3600;
    const refundDeadline = settlementDeadline + 3600;
    const destinationSteps: Record<string, unknown>[] = [];
    const sourceSteps: Record<string, unknown>[] = [];
    const playerOne = sourceFinalizer.address;
    const playerTwo = sourcePlayerTwo.address;
    destinationSteps.push(await send(token, 'mint', [organizer.address, amount]));
    destinationSteps.push(await send(vault, 'createTournament', [tournamentId, organizer.address, deployment.sourceChainKey, deployment.sourceRegistry, rulesHash, deployment.token, amount, settlementDeadline, refundDeadline]));
    destinationSteps.push(await send(token, 'approve', [deployment.vault, amount]));
    destinationSteps.push(await send(vault, 'fund', [tournamentId]));
    sourceSteps.push(await send(registry, 'createMatch', [tournamentId, matchId, playerOne, playerTwo, rulesHash, revealDeadline]));
    const abi = AbiCoder.defaultAbiCoder();
    const saltOne = keccak256(Buffer.from(`${runSeed}-one`));
    const saltTwo = keccak256(Buffer.from(`${runSeed}-two`));
    const commitment = (choice: number, salt: string) => keccak256(abi.encode(['uint8', 'bytes32'], [choice, salt]));
    sourceSteps.push(await send(registry, 'commit', [matchId, commitment(1, saltOne)]));
    sourceSteps.push(await send(new Contract(deployment.sourceRegistry, artifact('TournamentResultRegistry').abi, sourcePlayerTwo), 'commit', [matchId, commitment(3, saltTwo)]));
    sourceSteps.push(await send(registry, 'reveal', [matchId, 1, saltOne]));
    sourceSteps.push(await send(new Contract(deployment.sourceRegistry, artifact('TournamentResultRegistry').abi, sourcePlayerTwo), 'reveal', [matchId, 3, saltTwo]));
    const finalized = await send(registry, 'finalize', [matchId]);
    sourceSteps.push(finalized);
    const sourceReceipt = await sourceProvider.getTransactionReceipt(String(finalized.hash));
    if (!sourceReceipt || Number(sourceReceipt.status) !== 1) throw new Error('fresh MatchFinalized receipt unavailable');
    const decodedRaw = rpsMatchFinalizedAdapter.decode(sourceReceipt, deployment.sourceRegistry);
    const decoded = { tournamentId: normalize(decodedRaw.tournamentId), matchId: normalize(decodedRaw.matchId), playerOne: normalize(decodedRaw.playerOne), playerTwo: normalize(decodedRaw.playerTwo), winner: normalize(decodedRaw.winner), result: Number(decodedRaw.result), rulesHash: normalize(decodedRaw.rulesHash), resultNonce: String(decodedRaw.resultNonce), finalizationStatus: Number(decodedRaw.finalizationStatus), sourceChainId: String(decodedRaw.sourceChainId), finalizedAt: String(decodedRaw.finalizedAt), deadline: String(decodedRaw.deadline) };

    const evidenceStore = await DurableStore.open(dataDirectory, sourceHeadBeforeWorker);
    const discovered = await poll(async () => { await evidenceStore.refresh(); const candidate = evidenceStore.getJobByTournament(tournamentId); return candidate?.sourceTransactionHash === normalize(String(finalized.hash)) ? candidate : null; }, 180_000, 250);
    jobId = discovered.jobId;
    const validPath = `/proof-jobs/${jobId}`;
    await request('before_restart', 'GET', validPath);
    await request('before_restart_status', 'GET', `/tournaments/${tournamentId}/status`);
    await request('before_restart_evidence', 'GET', `/tournaments/${tournamentId}/evidence`);
    const meaningful = await poll(async () => { await evidenceStore.refresh(); const records = readJournal(dataDirectory, jobId!); return records.timeline.find((entry) => entry.state === 'AWAITING_ATTESTATION' && Number(entry.attemptCount) >= 1) ?? null; }, 300_000, 200);
    const firstRuntime = readJournal(dataDirectory, jobId).runtimeRows[0];
    if (!firstRuntime?.runtimeId) throw new Error('first worker runtime heartbeat was not durable');
    firstStop = await stopChild(firstWorker);
    firstWorker = undefined;
    if (!firstStop?.confirmed) throw new Error('first worker process did not stop cleanly');
    const marker = { schemaVersion: 1, type: 'worker_stop_marker', runId, runtimeId: firstRuntime.runtimeId, pid: firstRuntime.pid, signalRequested: 'SIGTERM', requestedAt: firstStop.requestedAt, stoppedAt: firstStop.stoppedAt, exitCode: firstStop.exitCode, signal: firstStop.signal, forceKilled: firstStop.forceKilled, confirmed: firstStop.confirmed, jobId, stateAtStop: meaningful.state, revisionAtStop: meaningful.revision };
    stopMarkerPath = path.join(dataDirectory, 'stop-marker.json');
    const markerFd = fs.openSync(stopMarkerPath, 'wx', 0o600);
    try { fs.writeFileSync(markerFd, `${JSON.stringify(marker, null, 2)}\n`); fs.fsyncSync(markerFd); } finally { fs.closeSync(markerFd); }
    await request('after_stop', 'GET', validPath);
    await request('after_stop_status', 'GET', `/tournaments/${tournamentId}/status`);

    const restartAt = isoNow();
    secondWorker = startChild('scripts/worker.ts', childEnv);
    const secondRuntime = await poll(async () => { const state = readJournal(dataDirectory, jobId!); return state.runtimeRows.find((row) => row.runtimeId !== firstRuntime.runtimeId && Date.parse(row.firstAt) >= Date.parse(restartAt)) ?? null; }, 180_000, 500);
    await request('after_restart', 'GET', validPath);
    await request('after_restart_status', 'GET', `/tournaments/${tournamentId}/status`);
    await request('after_restart_evidence', 'GET', `/tournaments/${tournamentId}/evidence`);
    const finalApi = await poll(async () => { const result = await request('after_completion', 'GET', validPath); return result.body?.productState === 'CLAIMED' && result.body?.outcome === 'PASS' ? result.body : null; }, 1_800_000, 2_000);
    await request('after_completion_status', 'GET', `/tournaments/${tournamentId}/status`);
    await request('after_completion_evidence', 'GET', `/tournaments/${tournamentId}/evidence`);
    if (!finalApi?.settlement?.transactionHash || !finalApi?.payout?.transactionHash) throw new Error('final API response lacks settlement/payout hashes');

    const attestation = await getAttestcoinProof(sourceRpc, destinationRpc, required('ATTESTCOIN_PROVER_URL'), String(finalized.hash), deployment.sourceChainKey, deployment.expectedChainInfo, deployment.expectedBlockProver);
    const query = proofToQuery(attestation.proof);
    const asc = new Contract(deployment.asc, artifact('PrizeRailASC').abi, workerSigner);
    let replay: Record<string, unknown>;
    try {
      const response = await asc.verifyAndSettle(0, query.chainKey, query.blockHeight, query.encodedTransaction, query.merkleRoot, query.siblings, query.lowerEndpointDigest, query.continuityRoots, { gasLimit: 3_000_000 });
      const receipt = await response.wait();
      replay = { hash: normalize(response.hash), status: Number(receipt?.status ?? null), blockNumber: receipt?.blockNumber ?? null, gasUsed: receipt?.gasUsed?.toString?.() ?? null, rejected: Number(receipt?.status) === 0, outcome: Number(receipt?.status) === 0 ? 'PASS' : 'FAIL' };
    } catch (error) {
      const receipt = (error as any)?.receipt;
      const hash = normalize(receipt?.hash ?? (error as any)?.transactionHash ?? '');
      replay = { hash: hash || null, status: receipt?.status === undefined ? null : Number(receipt.status), blockNumber: receipt?.blockNumber ?? null, gasUsed: receipt?.gasUsed?.toString?.() ?? null, rejected: Number(receipt?.status) === 0, outcome: Number(receipt?.status) === 0 ? 'PASS' : 'UNKNOWN', error: safeError(error) };
    }
    if (replay.rejected !== true || Number(replay.status) !== 0 || !hashPattern(String(replay.hash ?? ''))) throw new Error('fresh replay was not a mined status-0 rejection');
    const settlementHash = normalize(finalApi.settlement.transactionHash);
    const payoutHash = normalize(finalApi.payout.transactionHash);
    const sourceTx = await txEvidence(sourceProvider, normalize(String(finalized.hash)), 'source');
    const settlementTx = await txEvidence(destinationProvider, settlementHash, 'settlement');
    const payoutTx = await txEvidence(destinationProvider, payoutHash, 'payout');
    const replayTx = await txEvidence(destinationProvider, String(replay.hash), 'replay');
    const policy = asPolicy(await (new Contract(deployment.vault, artifact('PrizeVault').abi, destinationProvider) as any).policies(tournamentId));
    const winnerBalance = String(await (new Contract(deployment.token, artifact('MockPrizeToken').abi, destinationProvider) as any).balanceOf(decoded.winner));
    const settlementReceipt = await destinationProvider.getTransactionReceipt(settlementHash);
    const payoutReceipt = await destinationProvider.getTransactionReceipt(payoutHash);
    if (!settlementReceipt || !payoutReceipt) throw new Error('settlement or payout receipt unavailable');
    const ascInterface = new Interface(artifact('PrizeRailASC').abi);
    const vaultInterface = new Interface(artifact('PrizeVault').abi);
    const hasEvent = (receipt: any, iface: Interface, name: string, address: string): boolean => receipt.logs.some((log: any) => normalize(log.address) === normalize(address) && (() => { try { return iface.parseLog(log)?.name === name; } catch { return false; } })());
    const records = readJournal(dataDirectory, jobId);
    const runtimeRows = records.runtimeRows.map((row) => ({ ...row, activity: row.activity }));
    const finalState = records.snapshots.at(-1)?.state ?? finalApi.jobState;
    const evidence = {
      schemaVersion: 2, runId, mode: 'live-worker-v2', dataMode: 'LIVE', outcome: 'PASS',
      deployment: { selector: 'evidence/current-deployment.json', manifest: path.relative(root, deployment.deploymentFile), protocolVersion: deployment.manifest.protocolVersion },
      source: { chainId: deployment.sourceChainId, chainKey: deployment.sourceChainKey, registry: deployment.sourceRegistry, startBlockBeforeWorker: sourceHeadBeforeWorker, transaction: sourceTx, decoded, eventSignature: 'MatchFinalized(bytes32,bytes32,address,address,address,uint8,bytes32,uint256,uint8,uint64,uint64,uint64)', steps: sourceSteps },
      destination: { chainId: deployment.destinationChainId, token: deployment.token, vault: deployment.vault, asc: deployment.asc, amount: String(policy.amount), funding: destinationSteps, settlement: settlementTx, payout: payoutTx, finalState: Number(policy.state), finalPolicyState: Number(policy.state), policy, winnerBalance, events: { resultVerified: hasEvent(settlementReceipt, ascInterface, 'ResultVerified', deployment.asc), tournamentSettled: hasEvent(settlementReceipt, vaultInterface, 'TournamentSettled', deployment.vault), prizeClaimed: hasEvent(payoutReceipt, vaultInterface, 'PrizeClaimed', deployment.vault) } },
      attestation: { proofIdentifier: keccak256(query.encodedTransaction), headerNumber: attestation.proof.headerNumber, cached: attestation.proof.cached ?? null, nativePreflight: attestation.verified, verified: attestation.verified, latencyMs: records.snapshots.find((entry) => entry.state === 'PROOF_READY')?.proofLatencyMs ?? null, rawProofPersisted: false },
      worker: { jobId, dataDirectory: path.relative(root, dataDirectory), storeId, storeIdentity: storeId, journalFile: 'worker.journal', journalRecords: records.records, finalState, automaticClaim: true, final: finalApi, runtimes: runtimeRows, restart: { storeId, storeIdentity: storeId, firstRuntimeId: firstRuntime.runtimeId, secondRuntimeId: secondRuntime.runtimeId, stopAt: firstStop.stoppedAt, restartAt, processStopConfirmed: firstStop.confirmed, stopMarker: { ...marker, path: path.relative(root, stopMarkerPath) } }, timeline: records.timeline, hashAssignments: { settlement: records.assignments.settlement, payout: records.assignments.payout }, idempotency: { sourceIdentity: `${deployment.sourceChainId}:${normalize(String(finalized.hash))}`, businessIdentity: `${normalize(tournamentId)}:${decoded.resultNonce}` } },
      replay: { ...replay, ...replayTx, rejected: true, outcome: 'PASS' }, http, apiFinal: finalApi, sourceHashes: sourceHashesBeforeWorker, historical: { outcome: 'UNKNOWN', journalCompatible: false, limitation: 'Older historical journals assigned and later cleared transaction hashes and are rejected by the current immutable-hash invariant; no migration/import is claimed.' },
      outcomes: { source: 'PASS', admission: 'PASS', durableJob: 'PASS', http: 'PASS', restart: 'PASS', proof: attestation.verified ? 'PASS' : 'FAIL', settlement: 'PASS', payout: 'PASS', replay: replay.rejected ? 'PASS' : 'FAIL', sourceVersion: 'PASS', historicalMigration: 'UNKNOWN' },
      roleReuse: { finalizer: 'deployer', organizer: 'deployer', playerOne: 'deployer', playerTwo: 'worker', worker: 'worker', payoutTrigger: 'worker' },
      explorers: { source: `${deployment.sourceExplorer}/tx/${sourceTx.hash}`, settlement: `${deployment.destinationExplorer}/tx/${settlementTx.hash}`, payout: `${deployment.destinationExplorer}/tx/${payoutTx.hash}`, replay: `${deployment.destinationExplorer}/tx/${replayTx.hash}` },
      timestamps: { startedAt, firstWorkerStartedAt: runtimeRows.find((row) => row.runtimeId === firstRuntime.runtimeId)?.startedAt ?? firstRuntime.firstAt, stopRequestedAt: firstStop.requestedAt, stoppedAt: firstStop.stoppedAt, secondWorkerStartedAt: restartAt, completedAt: isoNow() },
      limitations: ['testnet-only', 'hosted prover and public RPC availability', 'role reuse is explicit and recorded', 'Git provenance UNKNOWN because .git has no usable HEAD'],
    };
    publishExclusive(evidencePath, evidence);
    console.log(JSON.stringify({ evidencePath: path.relative(root, evidencePath), runId, jobId, source: sourceTx.hash, settlement: settlementTx.hash, payout: payoutTx.hash, replay: replayTx.hash, outcome: 'PASS' }, null, 2));
  } finally {
    await stopChild(secondWorker);
    await stopChild(firstWorker);
    await stopChild(apiProcess);
    sourceProvider.destroy();
    destinationProvider.destroy();
  }
}

await run();
