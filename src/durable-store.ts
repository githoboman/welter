import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { businessIdentity, normalizeHex, sourceIdentity, type Cursor, type EventObservation, type JobState, type StoreState, type Transition, type WorkerHeartbeat, type WorkerJob } from './worker-types.js';

const SCHEMA_VERSION = 1 as const;

const JOB_STATES = new Set<JobState>([
  'DISCOVERED',
  'WAITING_FOR_POLICY',
  'MINED',
  'AWAITING_ATTESTATION',
  'PROOF_READY',
  'PROOF_PREFLIGHT_PASS',
  'PROOF_PREFLIGHT_FAIL',
  'SUBMITTING',
  'SETTLEMENT_PENDING',
  'SETTLEMENT_COMPLETE',
  'CLAIMABLE',
  'PAYOUT_PENDING',
  'CLAIMED',
  'REFUNDED',
  'NON_PAYABLE_RESULT',
  'VERIFICATION_FAILED',
  'REPLAY_REJECTED',
  'ALREADY_SETTLED',
  'INFRASTRUCTURE_UNAVAILABLE',
  'UNKNOWN',
]);
const OUTCOMES = new Set(['PASS', 'FAIL', 'UNKNOWN']);
const PROOF_STATUSES = new Set(['NOT_REQUESTED', 'PENDING', 'AVAILABLE', 'PREFLIGHT_PASS', 'PREFLIGHT_FAIL', 'UNKNOWN']);
const ERROR_CLASSES = new Set([
  'INVALID_CONFIGURATION',
  'INVALID_INPUT',
  'SOURCE_NOT_FOUND',
  'SOURCE_FAILED',
  'WRONG_SOURCE_CHAIN',
  'WRONG_SOURCE_REGISTRY',
  'WRONG_EVENT',
  'WRONG_TOURNAMENT',
  'WRONG_RULES',
  'WRONG_WINNER',
  'INVALID_NONCE',
  'INVALID_RESULT',
  'POLICY_NOT_FOUND',
  'POLICY_NOT_FUNDED',
  'POLICY_EXPIRED',
  'POLICY_REFUNDED',
  'ALREADY_SETTLED',
  'REPLAYED',
  'PROVER_UNAVAILABLE',
  'RPC_UNAVAILABLE',
  'MALFORMED_PROOF',
  'PROOF_REJECTED',
  'SEMANTIC_REJECTION',
  'PERSISTENCE_FAILURE',
  'UNKNOWN',
]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^\d{1,78}$/;
// The store is also used by deterministic fixtures and older local journals;
// keep its identity grammar broader than the public API route while excluding
// path/prototype-control characters.
const JOB_ID = /^job-[A-Za-z0-9_-]{1,128}$/;

type JournalRecord =
  | { op: 'cursor'; cursor: Cursor }
  | { op: 'observation'; observation: EventObservation }
  | { op: 'job'; job: WorkerJob; transition?: Transition }
  | { op: 'transition'; transition: Transition }
  | { op: 'heartbeat'; heartbeat: WorkerHeartbeat };

function now(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function isDecimal(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL.test(value);
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && BYTES32.test(value);
}

function isAddress(value: unknown): value is string {
  return typeof value === 'string' && ADDRESS.test(value);
}

function isIso(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 80) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 8_640_000_000_000_000;
}

function optional<T>(value: unknown, predicate: (candidate: unknown) => candidate is T): boolean {
  return value === null || value === undefined || predicate(value);
}

function assertValid(condition: boolean, field: string): void {
  if (!condition) throw new Error(`invalid journal ${field}`);
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`invalid journal ${field}`);
}

function assertTransition(value: unknown, field = 'transition'): asserts value is Transition {
  assertRecord(value, field);
  assertValid(isIso(value.at), `${field}.at`);
  assertValid(typeof value.jobId === 'string' && JOB_ID.test(value.jobId), `${field}.jobId`);
  assertValid(value.from === null || (typeof value.from === 'string' && JOB_STATES.has(value.from as JobState)), `${field}.from`);
  assertValid(typeof value.to === 'string' && JOB_STATES.has(value.to as JobState), `${field}.to`);
  assertValid(typeof value.reason === 'string' && value.reason.length <= 320, `${field}.reason`);
}

function assertCursor(value: unknown): asserts value is Cursor {
  assertRecord(value, 'cursor');
  assertValid(value.schemaVersion === SCHEMA_VERSION, 'cursor.schemaVersion');
  assertValid(isSafeInteger(value.nextBlock), 'cursor.nextBlock');
  assertValid(value.lastScannedBlock === null || isSafeInteger(value.lastScannedBlock), 'cursor.lastScannedBlock');
  assertValid(isIso(value.updatedAt), 'cursor.updatedAt');
}

function assertObservation(value: unknown): asserts value is EventObservation {
  assertRecord(value, 'observation');
  assertValid(isSafeInteger(value.sourceChainId), 'observation.sourceChainId');
  assertValid(isSafeInteger(value.sourceChainKey), 'observation.sourceChainKey');
  assertValid(isHash(value.transactionHash), 'observation.transactionHash');
  assertValid(isSafeInteger(value.blockNumber), 'observation.blockNumber');
  assertValid(optional(value.blockHash, isHash), 'observation.blockHash');
  assertValid(isAddress(value.registry), 'observation.registry');
  assertValid(typeof value.eventSignature === 'string' && value.eventSignature.length > 0 && value.eventSignature.length <= 256, 'observation.eventSignature');
  assertValid(value.receiptStatus === null || value.receiptStatus === 0 || value.receiptStatus === 1, 'observation.receiptStatus');
  assertValid(isIso(value.observedAt), 'observation.observedAt');
}

function assertPolicy(value: unknown): void {
  if (value === null) return;
  assertRecord(value, 'job.policy');
  // Policy values are chain data. Keep the journal boundary strict enough to
  // prevent prototype keys and unbounded strings without imposing semantic
  // state checks that belong to worker/API validation.
  for (const [key, candidate] of Object.entries(value)) {
    assertValid(/^[A-Za-z][A-Za-z0-9_]*$/.test(key) && key.length <= 64, 'job.policy.key');
    assertValid((typeof candidate === 'string' && candidate.length <= 256) || (typeof candidate === 'number' && Number.isSafeInteger(candidate)), 'job.policy.value');
  }
}

function assertEvidence(value: unknown, field: string): void {
  if (value === null) return;
  assertRecord(value, field);
  assertValid(Object.keys(value).length <= 64, `${field}.keys`);
}

function assertJob(value: unknown): asserts value is WorkerJob {
  assertRecord(value, 'job');
  assertValid(value.schemaVersion === SCHEMA_VERSION, 'job.schemaVersion');
  assertValid(typeof value.jobId === 'string' && JOB_ID.test(value.jobId), 'job.jobId');
  assertValid(isSafeInteger(value.sourceChainId), 'job.sourceChainId');
  assertValid(isSafeInteger(value.sourceChainKey), 'job.sourceChainKey');
  assertValid(isHash(value.sourceTransactionHash), 'job.sourceTransactionHash');
  assertValid(isSafeInteger(value.sourceBlockNumber), 'job.sourceBlockNumber');
  assertValid(optional(value.sourceBlockHash, isHash), 'job.sourceBlockHash');
  assertValid(optional(value.sourceGas, isDecimal), 'job.sourceGas');
  assertValid(optional(value.sourceTimestamp, isIso), 'job.sourceTimestamp');
  assertValid(isAddress(value.sourceRegistry), 'job.sourceRegistry');
  assertValid(typeof value.sourceEventSignature === 'string' && value.sourceEventSignature.length > 0 && value.sourceEventSignature.length <= 256, 'job.sourceEventSignature');
  assertValid(isHash(value.tournamentId) && !/^0x0{64}$/i.test(value.tournamentId), 'job.tournamentId');
  assertValid(isHash(value.matchId) && !/^0x0{64}$/i.test(value.matchId), 'job.matchId');
  assertValid(isAddress(value.playerOne), 'job.playerOne');
  assertValid(isAddress(value.playerTwo), 'job.playerTwo');
  assertValid(isAddress(value.winner), 'job.winner');
  assertValid(isSafeInteger(value.result) && value.result <= 4, 'job.result');
  assertValid(isHash(value.rulesHash), 'job.rulesHash');
  assertValid(isDecimal(value.resultNonce), 'job.resultNonce');
  assertValid(isSafeInteger(value.finalizationStatus) && value.finalizationStatus <= 1, 'job.finalizationStatus');
  assertValid(isDecimal(value.sourceDeadline), 'job.sourceDeadline');
  assertValid(isDecimal(value.sourceFinalizedAt), 'job.sourceFinalizedAt');
  assertValid(value.sourceReceiptStatus === null || value.sourceReceiptStatus === 0 || value.sourceReceiptStatus === 1, 'job.sourceReceiptStatus');
  assertValid(typeof value.state === 'string' && JOB_STATES.has(value.state as JobState), 'job.state');
  assertValid(typeof value.productState === 'string' && JOB_STATES.has(value.productState as JobState), 'job.productState');
  assertValid(value.dataMode === 'LIVE', 'job.dataMode');
  assertValid(typeof value.outcome === 'string' && OUTCOMES.has(value.outcome), 'job.outcome');
  assertValid(typeof value.evidenceOutcome === 'string' && OUTCOMES.has(value.evidenceOutcome), 'job.evidenceOutcome');
  assertValid(isSafeInteger(value.attemptCount), 'job.attemptCount');
  assertValid(isSafeInteger(value.retryCount), 'job.retryCount');
  assertValid(optional(value.nextRetryAt, isIso), 'job.nextRetryAt');
  if (value.lease !== null) {
    assertRecord(value.lease, 'job.lease');
    const lease = value.lease;
    assertValid(typeof lease.owner === 'string' && lease.owner.length > 0 && lease.owner.length <= 128, 'job.lease.owner');
    assertValid(isIso(lease.expiresAt), 'job.lease.expiresAt');
  }
  assertValid(isIso(value.createdAt), 'job.createdAt');
  assertValid(isIso(value.updatedAt), 'job.updatedAt');
  assertValid(typeof value.proofStatus === 'string' && PROOF_STATUSES.has(value.proofStatus), 'job.proofStatus');
  assertValid(value.proofHeader === null || isSafeInteger(value.proofHeader), 'job.proofHeader');
  assertValid(optional(value.proofDigest, isHash), 'job.proofDigest');
  assertValid(value.proofCached === null || typeof value.proofCached === 'boolean', 'job.proofCached');
  assertValid(value.proofLatencyMs === null || isSafeInteger(value.proofLatencyMs), 'job.proofLatencyMs');
  assertValid(typeof value.proofPreflightOutcome === 'string' && OUTCOMES.has(value.proofPreflightOutcome), 'job.proofPreflightOutcome');
  assertValid(optional(value.settlementTransactionHash, isHash), 'job.settlementTransactionHash');
  assertValid(value.settlementReceiptStatus === null || value.settlementReceiptStatus === 0 || value.settlementReceiptStatus === 1, 'job.settlementReceiptStatus');
  assertValid(value.settlementBlock === null || isSafeInteger(value.settlementBlock), 'job.settlementBlock');
  assertValid(optional(value.settlementGas, isDecimal), 'job.settlementGas');
  assertValid(optional(value.settlementTimestamp, isIso), 'job.settlementTimestamp');
  assertValid(optional(value.payoutTransactionHash, isHash), 'job.payoutTransactionHash');
  assertValid(value.submissionUncertainty === undefined || typeof value.submissionUncertainty === 'boolean', 'job.submissionUncertainty');
  assertValid(value.submissionPhase === undefined || value.submissionPhase === 'SETTLEMENT' || value.submissionPhase === 'PAYOUT', 'job.submissionPhase');
  assertValid(value.payoutReceiptStatus === null || value.payoutReceiptStatus === 0 || value.payoutReceiptStatus === 1, 'job.payoutReceiptStatus');
  assertValid(value.payoutBlock === null || isSafeInteger(value.payoutBlock), 'job.payoutBlock');
  assertValid(optional(value.payoutGas, isDecimal), 'job.payoutGas');
  assertValid(optional(value.payoutTimestamp, isIso), 'job.payoutTimestamp');
  assertEvidence(value.replayEvidence, 'job.replayEvidence');
  assertEvidence(value.refundRecoveryEvidence, 'job.refundRecoveryEvidence');
  assertValid(value.policyState === null || (isSafeInteger(value.policyState) && value.policyState <= 4), 'job.policyState');
  assertPolicy(value.policy);
  assertValid(value.resultVerified === null || typeof value.resultVerified === 'boolean', 'job.resultVerified');
  assertValid(value.tournamentSettled === null || typeof value.tournamentSettled === 'boolean', 'job.tournamentSettled');
  assertValid(value.prizeClaimed === null || typeof value.prizeClaimed === 'boolean', 'job.prizeClaimed');
  assertRecord(value.explorerLinks, 'job.explorerLinks');
  for (const candidate of Object.values(value.explorerLinks)) assertValid(candidate === null || (typeof candidate === 'string' && candidate.length <= 512), 'job.explorerLinks.value');
  assertValid(value.lastErrorClass === null || (typeof value.lastErrorClass === 'string' && ERROR_CLASSES.has(value.lastErrorClass)), 'job.lastErrorClass');
  assertValid(value.lastErrorMessage === null || (typeof value.lastErrorMessage === 'string' && value.lastErrorMessage.length <= 320), 'job.lastErrorMessage');
  assertValid(Array.isArray(value.evidenceReferences) && value.evidenceReferences.length <= 256, 'job.evidenceReferences');
  const evidenceReferences = value.evidenceReferences as unknown[];
  for (const reference of evidenceReferences) assertValid(typeof reference === 'string' && reference.length <= 256, 'job.evidenceReferences.value');
}

function assertHeartbeat(value: unknown): asserts value is WorkerHeartbeat {
  assertRecord(value, 'heartbeat');
  assertValid(typeof value.owner === 'string' && value.owner.length > 0 && value.owner.length <= 128, 'heartbeat.owner');
  assertValid(isIso(value.at), 'heartbeat.at');
}

function assertJournalRecord(value: unknown): asserts value is JournalRecord {
  assertRecord(value, 'record');
  assertValid(value.op === 'cursor' || value.op === 'observation' || value.op === 'job' || value.op === 'transition' || value.op === 'heartbeat', 'record.op');
  if (value.op === 'cursor') assertCursor(value.cursor);
  else if (value.op === 'observation') assertObservation(value.observation);
  else if (value.op === 'job') {
    assertJob(value.job);
    if (value.transition !== undefined) assertTransition(value.transition, 'job.transition');
  } else if (value.op === 'transition') assertTransition(value.transition);
  else assertHeartbeat(value.heartbeat);
}

function safePersistenceError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/(?:[a-z][a-z0-9+.-]*):\/\/[^\s]+/gi, '[url-redacted]')
    .replace(/(?:^|[\s'\"])(?:[A-Za-z]:[\\/]|\/)(?:[^\s'\",;)]*)/g, '$1[path-redacted]')
    .replace(/(?:PRIVATE_KEY|SESSION_SECRET|DATABASE_URL|API_KEY|TOKEN)=?[^\s,;]*/gi, '[secret-redacted]')
    .replace(/0x[a-fA-F0-9]{40,}/g, '[hex-redacted]')
    .replace(/[a-fA-F0-9]{80,}/g, '[hex-redacted]')
    .slice(0, 320);
}

/**
 * A journal append is newline-terminated.  If a process dies while writing,
 * the final line can contain a syntactically incomplete JSON object.  Only
 * that case is repairable; a complete but invalid record must fail closed even
 * when the newline itself was lost.
 */
function isIncompleteJson(value: string): boolean {
  let inString = false;
  let escaped = false;
  let depth = 0;
  let rootClosed = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{' || character === '[') {
      if (rootClosed) return false;
      depth += 1;
    } else if (character === '}' || character === ']') {
      if (depth === 0) return false;
      depth -= 1;
      if (depth === 0) rootClosed = true;
    } else if (rootClosed && !/\s/.test(character)) {
      return false;
    }
  }
  return inString || depth > 0;
}

function sourceKey(job: Pick<WorkerJob, 'sourceChainId' | 'sourceTransactionHash'>): string {
  return sourceIdentity(job.sourceChainId, job.sourceTransactionHash);
}

function businessKey(job: Pick<WorkerJob, 'tournamentId' | 'resultNonce'>): string {
  return businessIdentity(job.tournamentId, job.resultNonce);
}

function tournamentKey(tournamentId: string): string {
  return normalizeHex(tournamentId);
}

function transactionKey(hash: string): string {
  return normalizeHex(hash);
}

function optionalTransactionKey(hash: string | null): string | null {
  return hash ? transactionKey(hash) : null;
}

function optionalTransactionChanged(previous: string | null, next: string | null): boolean {
  // A transaction identity is assigned once.  The initial null -> hash
  // transition is expected; clearing or replacing an assigned hash is not.
  return previous !== null && optionalTransactionKey(previous) !== optionalTransactionKey(next);
}

function emptyState(startBlock: number): StoreState {
  return {
    schemaVersion: SCHEMA_VERSION,
    cursor: { schemaVersion: SCHEMA_VERSION, nextBlock: startBlock, lastScannedBlock: null, updatedAt: now() },
    jobs: {},
    sourceIndex: {},
    tournamentIndex: {},
    businessIndex: {},
    settlementIndex: {},
    payoutIndex: {},
    observations: {},
    transitions: [],
    workerHeartbeat: null,
  };
}

/**
 * A small append-only journal is used instead of an in-memory queue or a mutable
 * JSON blob. Each record is fsynced before the mutation is acknowledged. The
 * final partial line is treated as a crash tail and ignored; any malformed
 * complete line is a corruption error and fails closed.
 */
export class DurableStore {
  readonly directory: string;
  readonly journalPath: string;
  readonly lockPath: string;
  private readonly startBlock: number;
  private state: StoreState;
  private mutationQueue: Promise<void> = Promise.resolve();

  private constructor(directory: string, state: StoreState, startBlock: number) {
    this.directory = directory;
    this.journalPath = path.join(directory, 'worker.journal');
    this.lockPath = path.join(directory, 'worker.lock');
    this.startBlock = startBlock;
    this.state = state;
  }

  static async open(directory: string, startBlock: number): Promise<DurableStore> {
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    const store = new DurableStore(directory, emptyState(startBlock), startBlock);
    await store.withLock(async () => store.load(startBlock));
    return store;
  }

  private async load(startBlock: number, repairTail = true): Promise<void> {
    this.state = emptyState(startBlock);
    let content = '';
    try {
      content = await fs.promises.readFile(this.journalPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return;
    }
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) continue;
      const isTrailingPartial = index === lines.length - 1 && !content.endsWith('\n');
      let record: JournalRecord;
      try {
        record = JSON.parse(line) as JournalRecord;
      } catch (error) {
        if (isTrailingPartial && isIncompleteJson(line)) {
          if (repairTail) {
            const lastCompleteOffset = content.lastIndexOf('\n');
            await fs.promises.truncate(this.journalPath, lastCompleteOffset < 0 ? 0 : Buffer.byteLength(content.slice(0, lastCompleteOffset + 1)));
          }
          // Readers may observe a writer's partial final append.  Ignore it
          // for this snapshot; the next refresh will see the completed line.
          break;
        }
        throw new Error(`worker journal corruption at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
      try {
        this.apply(record);
      } catch (error) {
        // A syntactically complete record is never treated as a crash tail.
        // This preserves the fail-closed corruption guarantee for a final
        // record that was fully written but did not receive its newline.
        throw new Error(`worker journal corruption at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private assertImmutableIdentity(previous: WorkerJob | undefined, next: WorkerJob): void {
    if (!previous) return;
    if (sourceKey(previous) !== sourceKey(next)
      || tournamentKey(previous.tournamentId) !== tournamentKey(next.tournamentId)
      || businessKey(previous) !== businessKey(next)
      || optionalTransactionChanged(previous.settlementTransactionHash, next.settlementTransactionHash)
      || optionalTransactionChanged(previous.payoutTransactionHash, next.payoutTransactionHash)) {
      throw new Error(`immutable job identity mutation for ${next.jobId}`);
    }
  }

  private assertIndexOwner(index: Record<string, string>, key: string, jobId: string, label: string): void {
    const owner = index[key];
    if (owner && owner !== jobId) throw new Error(`journal ${label} index collision for ${key}: ${owner} vs ${jobId}`);
  }

  private assertJobIndexes(job: WorkerJob, jobId = job.jobId): void {
    this.assertIndexOwner(this.state.sourceIndex, sourceKey(job), jobId, 'source');
    this.assertIndexOwner(this.state.tournamentIndex, tournamentKey(job.tournamentId), jobId, 'tournament');
    this.assertIndexOwner(this.state.businessIndex, businessKey(job), jobId, 'business');
    if (job.settlementTransactionHash) this.assertIndexOwner(this.state.settlementIndex, transactionKey(job.settlementTransactionHash), jobId, 'settlement');
    if (job.payoutTransactionHash) this.assertIndexOwner(this.state.payoutIndex, transactionKey(job.payoutTransactionHash), jobId, 'payout');
  }

  private indexJob(job: WorkerJob): void {
    this.state.sourceIndex[sourceKey(job)] = job.jobId;
    this.state.tournamentIndex[tournamentKey(job.tournamentId)] = job.jobId;
    this.state.businessIndex[businessKey(job)] = job.jobId;
    if (job.settlementTransactionHash) this.state.settlementIndex[transactionKey(job.settlementTransactionHash)] = job.jobId;
    if (job.payoutTransactionHash) this.state.payoutIndex[transactionKey(job.payoutTransactionHash)] = job.jobId;
  }

  private apply(record: JournalRecord): void {
    assertJournalRecord(record);
    if (record.op === 'cursor') {
      this.state.cursor = record.cursor;
      return;
    }
    if (record.op === 'observation') {
      this.state.observations[record.observation.transactionHash] = record.observation;
      return;
    }
    if (record.op === 'job') {
      const previous = this.state.jobs[record.job.jobId];
      this.assertImmutableIdentity(previous, record.job);
      this.assertJobIndexes(record.job);
      this.state.jobs[record.job.jobId] = record.job;
      this.indexJob(record.job);
      if (record.transition) this.state.transitions.push(record.transition);
      return;
    }
    if (record.op === 'transition') {
      this.state.transitions.push(record.transition);
      return;
    }
    if (record.op === 'heartbeat') {
      this.state.workerHeartbeat = record.heartbeat;
      return;
    }
    throw new Error(`unknown journal operation ${(record as { op?: unknown }).op ?? 'missing'}`);
  }

  private async append(record: JournalRecord): Promise<void> {
    // Validate before fsync so a malformed in-process mutation cannot leave a
    // durable record that only fails on the next restart.
    assertJournalRecord(record);
    const line = `${JSON.stringify(record)}\n`;
    const handle = await fs.promises.open(this.journalPath, 'a', 0o600);
    try {
      await handle.write(line, null, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    this.apply(record);
  }

  private async reclaimAbandonedLock(): Promise<void> {
    const [stat, contents] = await Promise.all([
      fs.promises.stat(this.lockPath),
      fs.promises.readFile(this.lockPath, 'utf8'),
    ]);
    const match = contents.trim().match(/^(\d+):(\d+)$/);
    let ownerDead = false;
    if (match) {
      const ownerPid = Number(match[1]);
      if (Number.isSafeInteger(ownerPid) && ownerPid > 0 && ownerPid !== process.pid) {
        try { process.kill(ownerPid, 0); } catch (error) {
          ownerDead = (error as NodeJS.ErrnoException).code === 'ESRCH';
        }
      }
    }
    if (!ownerDead && Date.now() - stat.mtimeMs <= 120_000) return;

    // Recheck the inode and contents so a lock released and reacquired during
    // the liveness probe is not mistaken for the abandoned owner.
    const [currentStat, currentContents] = await Promise.all([
      fs.promises.stat(this.lockPath),
      fs.promises.readFile(this.lockPath, 'utf8'),
    ]);
    if (currentStat.ino === stat.ino
      && currentStat.mtimeMs === stat.mtimeMs
      && currentStat.size === stat.size
      && currentContents === contents) await fs.promises.unlink(this.lockPath);
  }

  private async withLock<T>(operation: () => Promise<T>, reload = false): Promise<T> {
    const previous = this.mutationQueue;
    let release!: () => void;
    this.mutationQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    let handle: fs.promises.FileHandle | undefined;
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
          handle = await fs.promises.open(this.lockPath, 'wx', 0o600);
          await handle.write(`${process.pid}:${Date.now()}\n`, null, 'utf8');
          await handle.sync();
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          try {
            await this.reclaimAbandonedLock();
          } catch (statError) {
            if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      if (!handle) throw new Error('could not acquire worker store lock');
      if (reload) await this.load(this.startBlock);
      return await operation();
    } finally {
      // Only the invocation that successfully created the lock may remove it.
      // A timed-out contender must leave the current owner's lock intact.
      if (handle) {
        await handle.close().catch(() => undefined);
        await fs.promises.unlink(this.lockPath).catch(() => undefined);
      }
      release();
    }
  }

  async health(): Promise<{ outcome: 'PASS' | 'FAIL'; message?: string }> {
    try {
      await fs.promises.access(this.directory, fs.constants.R_OK | fs.constants.W_OK);
      return { outcome: 'PASS' };
    } catch (error) {
      return { outcome: 'FAIL', message: safePersistenceError(error) };
    }
  }

  getCursor(): Cursor { return structuredClone(this.state.cursor); }
  getJob(jobId: string): WorkerJob | undefined { return this.state.jobs[jobId] ? structuredClone(this.state.jobs[jobId]) : undefined; }
  getJobByTournament(tournamentId: string): WorkerJob | undefined {
    const jobId = this.state.tournamentIndex[tournamentKey(tournamentId)];
    return jobId ? this.getJob(jobId) : undefined;
  }
  getJobByBusiness(tournamentId: string, resultNonce: string): WorkerJob | undefined {
    const jobId = this.state.businessIndex[businessIdentity(tournamentId, resultNonce)];
    return jobId ? this.getJob(jobId) : undefined;
  }
  getJobBySource(sourceChainId: number, txHash: string): WorkerJob | undefined {
    const jobId = this.state.sourceIndex[sourceIdentity(sourceChainId, txHash)];
    return jobId ? this.getJob(jobId) : undefined;
  }
  getJobs(): WorkerJob[] { return Object.values(this.state.jobs).map((job) => structuredClone(job)); }
  getTransitions(jobId?: string): Transition[] {
    return this.state.transitions.filter((transition) => !jobId || transition.jobId === jobId).map((transition) => structuredClone(transition));
  }

  async setCursor(cursor: Cursor): Promise<void> {
    await this.withLock(async () => {
      if (cursor.nextBlock <= this.state.cursor.nextBlock) return;
      await this.append({ op: 'cursor', cursor });
    }, true);
  }

  async refresh(): Promise<void> {
    // Readers do not take the writer lock: a proof request may hold a lease for
    // minutes, and the API must remain responsive while the journal is changing.
    // A partial final append is ignored and will be visible on the next refresh.
    await this.load(this.startBlock, false);
  }

  getWorkerHeartbeat(): WorkerHeartbeat | null { return this.state.workerHeartbeat ? structuredClone(this.state.workerHeartbeat) : null; }

  async setWorkerHeartbeat(heartbeat: WorkerHeartbeat): Promise<void> {
    await this.withLock(async () => this.append({ op: 'heartbeat', heartbeat }));
  }

  async recordObservation(observation: EventObservation): Promise<void> {
    await this.withLock(async () => this.append({ op: 'observation', observation }));
  }

  async saveJob(job: WorkerJob, reason = 'job updated', expectedLeaseOwner?: string): Promise<void> {
    await this.withLock(async () => {
      const previous = this.state.jobs[job.jobId];
      if (expectedLeaseOwner) {
        if (previous?.lease?.owner !== expectedLeaseOwner
          || Date.parse(previous.lease.expiresAt) <= Date.now()
          || job.lease?.owner !== expectedLeaseOwner) {
          throw new Error(`LEASE_LOST for ${job.jobId}`);
        }
      }
      this.assertImmutableIdentity(previous, job);
      this.assertJobIndexes(job);
      const stateTransition = previous?.state !== job.state
        ? { at: job.updatedAt, jobId: job.jobId, from: previous?.state ?? null, to: job.state, reason }
        : undefined;
      await this.append({ op: 'job', job, transition: stateTransition });
    }, true);
  }

  async createJob(job: WorkerJob, reason = 'job created'): Promise<{ job: WorkerJob; created: boolean }> {
    let result!: { job: WorkerJob; created: boolean };
    await this.withLock(async () => {
      const existingJob = this.state.jobs[job.jobId];
      this.assertImmutableIdentity(existingJob, job);
      const sourceOwner = this.state.sourceIndex[sourceKey(job)];
      const tournamentOwner = this.state.tournamentIndex[tournamentKey(job.tournamentId)];
      const businessOwner = this.state.businessIndex[businessKey(job)];
      const owners = [sourceOwner, tournamentOwner, businessOwner].filter((owner): owner is string => Boolean(owner));
      const uniqueOwners = [...new Set(owners)];
      if (uniqueOwners.length > 1) throw new Error(`job identity indexes disagree for ${job.jobId}: ${uniqueOwners.join(', ')}`);
      const existingId = uniqueOwners[0] ?? existingJob?.jobId;
      if (existingId) {
        const existing = this.state.jobs[existingId];
        if (!existing) throw new Error(`job index points to missing job ${existingId}`);
        // A tournament index by itself is not enough to identify an
        // idempotent replay: a new source transaction and business nonce for
        // the same tournament would otherwise be silently discarded. Source
        // and business keys are the only valid dedupe witnesses here. A
        // source-key hit without the same business key is likewise a malformed
        // source replay and must fail closed.
        const sourceMatches = sourceOwner === existingId;
        const businessMatches = businessOwner === existingId;
        const tournamentMatches = tournamentOwner === existingId;
        if (sourceMatches && !businessMatches) {
          throw new Error(`job source identity mismatch for ${job.jobId}: ${existingId}`);
        }
        if (tournamentMatches && !sourceMatches && !businessMatches) {
          throw new Error(`job tournament identity collision for ${job.jobId}: ${existingId}`);
        }
        if (existingId === job.jobId) this.assertJobIndexes(job);
        result = { job: structuredClone(this.state.jobs[existingId]), created: false };
        return;
      }
      this.assertJobIndexes(job);
      const stateTransition: Transition = { at: job.updatedAt, jobId: job.jobId, from: null, to: job.state, reason };
      await this.append({ op: 'job', job, transition: stateTransition });
      result = { job: structuredClone(job), created: true };
    }, true);
    return result;
  }

  async claimLease(jobId: string, owner: string, ttlMs: number): Promise<WorkerJob | undefined> {
    let result: WorkerJob | undefined;
    await this.withLock(async () => {
      const current = this.state.jobs[jobId];
      const nowMs = Date.now();
      if (!current) return;
      if (current.lease && current.lease.owner !== owner && Date.parse(current.lease.expiresAt) > nowMs) return;
      const updated = { ...current, lease: { owner, expiresAt: new Date(nowMs + ttlMs).toISOString() }, updatedAt: now() };
      await this.append({ op: 'job', job: updated });
      result = structuredClone(updated);
    }, true);
    return result;
  }

  async renewLease(jobId: string, owner: string, ttlMs: number): Promise<boolean> {
    let renewed = false;
    await this.withLock(async () => {
      const current = this.state.jobs[jobId];
      if (!current || current.lease?.owner !== owner || Date.parse(current.lease.expiresAt) <= Date.now()) return;
      const updated = { ...current, lease: { owner, expiresAt: new Date(Date.now() + ttlMs).toISOString() }, updatedAt: now() };
      await this.append({ op: 'job', job: updated });
      renewed = true;
    }, true);
    return renewed;
  }

  async releaseLease(jobId: string, owner: string): Promise<boolean> {
    let released = false;
    await this.withLock(async () => {
      const current = this.state.jobs[jobId];
      if (!current || current.lease?.owner !== owner || Date.parse(current.lease.expiresAt) <= Date.now()) return;
      const updated = { ...current, lease: null, updatedAt: now() };
      await this.append({ op: 'job', job: updated });
      released = true;
    }, true);
    return released;
  }

  newJobId(sourceChainId: number, txHash: string): string {
    return `job-${crypto.createHash('sha256').update(`${sourceChainId}:${txHash.toLowerCase()}`).digest('hex').slice(0, 24)}`;
  }
}

export function isTerminalState(state: JobState): boolean {
  return ['CLAIMED', 'REFUNDED', 'NON_PAYABLE_RESULT', 'VERIFICATION_FAILED', 'PROOF_PREFLIGHT_FAIL', 'REPLAY_REJECTED', 'ALREADY_SETTLED'].includes(state);
}
