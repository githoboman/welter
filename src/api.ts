import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { RPS_MATCH_FINALIZED_SIGNATURE } from './adapter.js';
import { normalizeHex, type WorkerJob } from './worker-types.js';
import { asPolicy, safeError, type WorkerConfig, WorkerRuntime } from './worker-runtime.js';

export interface LiveResponse {
  schemaVersion: 1;
  dataMode: 'LIVE';
  outcome: 'PASS' | 'FAIL' | 'UNKNOWN';
  productState: string;
  policyState: string | null;
  jobState: string | null;
  source: Record<string, unknown> | null;
  attestcoin: Record<string, unknown>;
  settlement: Record<string, unknown>;
  payout: Record<string, unknown>;
  replay: Record<string, unknown> | null;
  refundRecovery: Record<string, unknown> | null;
  evidenceReferences: string[];
  explorerLinks: Record<string, string | null>;
  timestamps: Record<string, string | null>;
  retry: Record<string, unknown>;
  error: Record<string, unknown> | null;
  jobId?: string;
  lifecycle?: Array<Record<string, unknown>>;
}

function policyName(state: number | null): string | null {
  if (state === null || state === undefined) return null;
  return ['DRAFT', 'FUNDED', 'CLAIMABLE', 'CLAIMED', 'REFUNDED'][state] ?? 'UNKNOWN';
}

function productForPolicy(state: number | null): string {
  return policyName(state) ?? 'UNKNOWN';
}

function policyStateIsAbsent(policy: Record<string, any> | null): boolean {
  if (!policy) return true;
  // The vault's absent sentinel is a DRAFT tuple with an all-zero organizer.
  // An advanced tuple with a zero organizer is malformed, not absent; treating
  // it as absent could hide a bad fresh response behind stale journal data.
  return Number(policy.state) === 0
    && String(policy.organizer ?? '').toLowerCase() === '0x0000000000000000000000000000000000000000';
}

function validAddress(value: unknown): boolean {
  return /^0x[0-9a-f]{40}$/i.test(String(value ?? ''));
}

function validHash(value: unknown): boolean {
  return /^0x[0-9a-f]{64}$/i.test(String(value ?? ''));
}

const JOB_STATES = new Set([
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

// Product state is a superset of the durable worker state. Policy and source
// match states are either authoritative chain states or derived UI states and
// therefore do not belong in the journal's JobState union.
const PRODUCT_STATES = new Set([
  'DRAFT',
  'FUNDED',
  'MATCH_PENDING',
  'MATCH_ACTIVE',
  'MATCH_FINALIZED',
  'MATCH_FINALIZATION_BLOCKED',
  'MATCH_TIMEOUT_FINALIZABLE',
  'MINED',
  'AWAITING_ATTESTATION',
  'PROOF_READY',
  'PROOF_PREFLIGHT_PASS',
  'PROOF_PREFLIGHT_FAIL',
  'ATTESTATION_VERIFIED',
  'SUBMITTING',
  'SETTLEMENT_PENDING',
  'SETTLEMENT_COMPLETE',
  'CLAIMABLE',
  'PAYOUT_PENDING',
  'PAYOUT_COMPLETE',
  'CLAIMED',
  'REFUND_AVAILABLE',
  'RECOVERY_AVAILABLE',
  'REFUNDED',
  'NON_PAYABLE_RESULT',
  'VERIFICATION_FAILED',
  'REPLAY_REJECTED',
  'ALREADY_SETTLED',
  'INFRASTRUCTURE_UNAVAILABLE',
  'UNKNOWN',
]);

const MAX_PUBLIC_TEXT = 320;
const MAX_EVIDENCE_REFERENCE = 256;
const MAX_EVIDENCE_REFERENCES = 64;
const MAX_LIFECYCLE_ENTRIES = 256;
const PROOF_STATUSES = new Set(['NOT_REQUESTED', 'PENDING', 'AVAILABLE', 'PREFLIGHT_PASS', 'PREFLIGHT_FAIL', 'UNKNOWN']);
const PUBLIC_ERROR_CLASSES = new Set([
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
  'INCONSISTENT_CLAIM_EVIDENCE',
  'UNKNOWN',
]);

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedPublicText(value: unknown, max = MAX_PUBLIC_TEXT): string | null {
  if (typeof value !== 'string') return null;
  // Journal text is not an authority boundary.  Redact provider URLs, local
  // paths, and credential-like tokens before exposing the bounded diagnostic.
  return safeError(value).slice(0, max);
}

function sanitizePublicError(value: unknown): string | Record<string, string> | null {
  if (typeof value === 'string') return boundedPublicText(value);
  const source = plainRecord(value);
  if (!source) return null;
  const message = boundedPublicText(source.message);
  if (message === null) return null;
  const suppliedClass = typeof source.class === 'string' ? source.class : 'UNKNOWN';
  const errorClass = PUBLIC_ERROR_CLASSES.has(suppliedClass) ? suppliedClass : 'UNKNOWN';
  return { class: errorClass, message };
}

function sanitizeJournalError(errorClass: unknown, message: unknown): Record<string, string> | null {
  const result = sanitizePublicError({ class: errorClass, message });
  return result && typeof result === 'object' ? result : null;
}

function publicInteger(value: unknown, minimum = 0): number | null {
  const numeric = typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(numeric) && numeric >= minimum ? numeric : null;
}

function publicStatus(value: unknown): number | null {
  const status = publicInteger(value, 0);
  return status !== null && (status === 0 || status === 1) ? status : null;
}

function publicDecimal(value: unknown): string | null {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  // uint256-sized values are sufficient for amounts, gas, and nonces while
  // preventing a malformed journal from inflating an API response.
  return /^\d{1,78}$/.test(text) ? text : null;
}

function publicIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 80) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 8_640_000_000_000_000) return null;
  try { return new Date(parsed).toISOString(); } catch { return null; }
}

function publicOutcome(value: unknown): 'PASS' | 'FAIL' | 'UNKNOWN' | null {
  return value === 'PASS' || value === 'FAIL' || value === 'UNKNOWN' ? value : null;
}

function publicJobState(value: unknown): string | null {
  return typeof value === 'string' && JOB_STATES.has(value) ? value : null;
}

function publicProductState(value: unknown): string | null {
  return typeof value === 'string' && PRODUCT_STATES.has(value) ? value : null;
}

function publicProofStatus(value: unknown): string {
  return typeof value === 'string' && PROOF_STATUSES.has(value) ? value : 'UNKNOWN';
}

function publicBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function publicCounter(value: unknown): number {
  return publicInteger(value, 0) ?? 0;
}

function publicExplorerBase(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) return null;
    parsed.pathname = parsed.pathname.replace(/\/$/, '');
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function sanitizeReplayEvidence(value: unknown): Record<string, unknown> | null {
  const source = plainRecord(value);
  if (!source) return null;
  const result: Record<string, unknown> = {};
  const outcome = publicOutcome(source.outcome);
  if (outcome) result.outcome = outcome;
  if (typeof source.rejected === 'boolean') result.rejected = source.rejected;
  const hash = normalizePublicValue(source.hash, validHash);
  if (hash) result.hash = hash;
  const sourceQueryKey = normalizePublicValue(source.sourceQueryKey, validHash);
  if (sourceQueryKey) result.sourceQueryKey = sourceQueryKey;
  const businessKey = normalizePublicValue(source.businessKey, validHash);
  if (businessKey) result.businessKey = businessKey;
  const status = publicStatus(source.status);
  if (status !== null) result.status = status;
  const blockNumber = publicInteger(source.blockNumber);
  if (blockNumber !== null) result.blockNumber = blockNumber;
  const gasUsed = publicDecimal(source.gasUsed);
  if (gasUsed !== null) result.gasUsed = gasUsed;
  const detectedAt = publicIsoTimestamp(source.detectedAt);
  if (detectedAt) result.detectedAt = detectedAt;
  const reason = boundedPublicText(source.reason);
  if (reason !== null) result.reason = reason;
  const error = sanitizePublicError(source.error);
  if (error !== null) result.error = error;
  // A malformed evidence record must never look like a successful replay
  // proof merely because an attacker supplied `rejected: true`.
  if (!('outcome' in result)) result.outcome = 'UNKNOWN';
  if (result.outcome === 'PASS'
    && !((result.rejected === true && typeof result.hash === 'string' && result.status === 0)
      || typeof result.sourceQueryKey === 'string'
      || typeof result.businessKey === 'string')) {
    result.outcome = 'UNKNOWN';
  }
  return result;
}

function sanitizeRecoveryEvidence(value: unknown): Record<string, unknown> | null {
  const source = plainRecord(value);
  if (!source) return null;
  const result: Record<string, unknown> = {};
  const outcome = publicOutcome(source.outcome);
  if (outcome) result.outcome = outcome;
  const beneficiary = normalizePublicValue(source.beneficiary, validAddress);
  if (beneficiary) result.beneficiary = beneficiary;
  const trigger = source.trigger === 'permissionless' || source.trigger === 'organizer'
    ? source.trigger
    : normalizePublicValue(source.trigger, validAddress);
  if (trigger) result.trigger = trigger;
  const state = publicInteger(source.state);
  if (state !== null && state <= 4) result.state = state;
  const amount = publicDecimal(source.amount);
  if (amount !== null) result.amount = amount;
  const settlementDeadline = publicInteger(source.settlementDeadline);
  if (settlementDeadline !== null) result.settlementDeadline = settlementDeadline;
  const refundDeadline = publicInteger(source.refundDeadline);
  if (refundDeadline !== null) result.refundDeadline = refundDeadline;
  const hash = normalizePublicValue(source.hash, validHash);
  if (hash) result.hash = hash;
  const status = publicStatus(source.status);
  if (status !== null) result.status = status;
  const blockNumber = publicInteger(source.blockNumber);
  if (blockNumber !== null) result.blockNumber = blockNumber;
  const gasUsed = publicDecimal(source.gasUsed);
  if (gasUsed !== null) result.gasUsed = gasUsed;
  const detectedAt = publicIsoTimestamp(source.detectedAt);
  if (detectedAt) result.detectedAt = detectedAt;
  const error = sanitizePublicError(source.error);
  if (error !== null) result.error = error;
  if (!('outcome' in result)) result.outcome = 'UNKNOWN';
  if (result.outcome === 'PASS' && (!result.beneficiary || !result.trigger)) result.outcome = 'UNKNOWN';
  return result;
}

function sanitizeEvidenceReference(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_EVIDENCE_REFERENCE) return null;
  // Evidence references are repository-relative labels, never arbitrary paths
  // supplied to a file-serving endpoint.  Keep the allowlist narrow and reject
  // alternate separators, traversal, URL schemes, and control characters.
  if (value !== value.replaceAll('\\', '/') || /[\u0000-\u001f\u007f]/.test(value)) return null;
  if (!/^evidence\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(value)) return null;
  const segments = value.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.length === 0)) return null;
  return value;
}

function sanitizeEvidenceReferences(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const references: string[] = [];
  for (const candidate of value) {
    const reference = sanitizeEvidenceReference(candidate);
    if (reference && !references.includes(reference)) references.push(reference);
    if (references.length >= MAX_EVIDENCE_REFERENCES) break;
  }
  return references;
}

function sanitizeLifecycle(value: unknown, expectedJobId?: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const transitions: Array<Record<string, unknown>> = [];
  for (const candidate of value) {
    const source = plainRecord(candidate);
    if (!source) continue;
    const jobId = typeof source.jobId === 'string' && validJobId(source.jobId) ? source.jobId : null;
    const at = publicIsoTimestamp(source.at);
    const to = typeof source.to === 'string' && JOB_STATES.has(source.to) ? source.to : null;
    const from = source.from === null
      ? null
      : typeof source.from === 'string' && JOB_STATES.has(source.from) ? source.from : undefined;
    const reason = boundedPublicText(source.reason);
    if (!jobId || (expectedJobId && jobId !== expectedJobId) || !at || !to || from === undefined || reason === null) continue;
    transitions.push({ at, jobId, from, to, reason });
    if (transitions.length >= MAX_LIFECYCLE_ENTRIES) break;
  }
  return transitions;
}

function normalizePublicValue(value: unknown, validator: (candidate: unknown) => boolean): string | null {
  return validator(value) ? normalizeHex(String(value)) : null;
}

function normalizePolicyForApi(policy: Record<string, any> | null): Record<string, unknown> | null {
  if (policyStateIsAbsent(policy)) return null;
  if (!policy || !Number.isInteger(Number(policy.state)) || Number(policy.state) < 0 || Number(policy.state) > 4) return null;
  return {
    organizer: normalizePublicValue(policy.organizer, validAddress),
    sourceChainKey: Number.isSafeInteger(Number(policy.sourceChainKey)) ? Number(policy.sourceChainKey) : null,
    sourceRegistry: normalizePublicValue(policy.sourceRegistry, validAddress),
    rulesHash: normalizePublicValue(policy.rulesHash, validHash),
    token: normalizePublicValue(policy.token, validAddress),
    amount: /^\d+$/.test(String(policy.amount ?? '')) ? String(policy.amount) : null,
    settlementDeadline: Number.isSafeInteger(Number(policy.settlementDeadline)) ? Number(policy.settlementDeadline) : null,
    refundDeadline: Number.isSafeInteger(Number(policy.refundDeadline)) ? Number(policy.refundDeadline) : null,
    winner: normalizePublicValue(policy.winner, validAddress),
    resultNonce: /^\d+$/.test(String(policy.resultNonce ?? '')) ? String(policy.resultNonce) : null,
    sourceQueryKey: normalizePublicValue(policy.sourceQueryKey, validHash),
    state: Number(policy.state),
  };
}

function nonzeroHash(value: unknown): boolean {
  return validHash(value) && !/^0x0{64}$/i.test(String(value));
}

function positiveDecimal(value: unknown): boolean {
  const text = publicDecimal(value);
  if (text === null) return false;
  try { return BigInt(text) > 0n; } catch { return false; }
}

function policyBindingError(policy: Record<string, any> | null, job: WorkerJob | undefined, config: WorkerConfig): { class: string; message: string } | null {
  if (!policy || policyStateIsAbsent(policy)) return null;
  const state = Number(policy.state);
  if (Number(policy.sourceChainKey) !== config.sourceChainKey) return { class: 'WRONG_SOURCE_CHAIN', message: 'fresh policy source chain key does not match the selected deployment' };
  if (!validAddress(policy.sourceRegistry) || normalizeHex(String(policy.sourceRegistry)) !== normalizeHex(config.sourceRegistry)) return { class: 'WRONG_SOURCE_REGISTRY', message: 'fresh policy source registry does not match the selected deployment' };
  if (!validAddress(policy.token) || normalizeHex(String(policy.token)) !== normalizeHex(config.token)) return { class: 'INVALID_INPUT', message: 'fresh policy token does not match the selected deployment' };
  if (job && (!validHash(policy.rulesHash) || normalizeHex(String(policy.rulesHash)) !== normalizeHex(job.rulesHash))) return { class: 'WRONG_RULES', message: 'fresh policy rules hash does not match the source result' };
  if (state === 2 || state === 3) {
    if (!validAddress(policy.winner) || /^0x0{40}$/i.test(String(policy.winner))) return { class: 'WRONG_WINNER', message: 'fresh settled policy winner is empty' };
    if (job && normalizeHex(String(policy.winner)) !== normalizeHex(job.winner)) return { class: 'WRONG_WINNER', message: 'fresh settled policy winner does not match the source result' };
    if (!positiveDecimal(policy.resultNonce)) return { class: 'INVALID_NONCE', message: 'fresh settled policy result nonce is invalid' };
    if (job) {
      try {
        if (BigInt(String(policy.resultNonce)) !== BigInt(String(job.resultNonce))) return { class: 'INVALID_NONCE', message: 'fresh settled policy result nonce does not match the source result' };
      } catch {
        return { class: 'INVALID_NONCE', message: 'fresh settled policy result nonce is invalid' };
      }
    }
    if (!nonzeroHash(policy.sourceQueryKey)) return { class: 'INVALID_INPUT', message: 'fresh settled policy source query key is invalid' };
  }
  return null;
}

function policyReadIsInfrastructure(error: { class: string; message: string } | null): boolean {
  return Boolean(error && (error.class === 'RPC_UNAVAILABLE' || error.class === 'UNKNOWN'));
}

function approvedExplorerLink(value: unknown, base: string | undefined, hash: unknown): string | null {
  if (!base || !validHash(hash)) return null;
  try {
    const baseUrl = new URL(base);
    const target = new URL(String(value ?? ''));
    // Explorer links are presentation data, but they are still an outbound
    // navigation boundary. Do not preserve credentials, ports, or a mutable
    // base URL into a link that the API presents as canonical evidence.
    if (
      baseUrl.protocol !== 'https:'
      || baseUrl.username
      || baseUrl.password
      || baseUrl.port
      || target.protocol !== 'https:'
      || target.username
      || target.password
      || target.port
      || target.host !== baseUrl.host
      || baseUrl.search
      || baseUrl.hash
      || target.search
      || target.hash
    ) return null;
    const basePath = baseUrl.pathname.replace(/\/$/, '');
    if (basePath && target.pathname !== basePath && !target.pathname.startsWith(`${basePath}/`)) return null;
    const expectedPath = `${basePath}/tx/${String(hash).toLowerCase()}`;
    if (target.pathname.toLowerCase() !== expectedPath.toLowerCase()) return null;
    return target.toString();
  } catch {
    return null;
  }
}

function publicExplorerLinks(job: WorkerJob | undefined, config: WorkerConfig | undefined): Record<string, string | null> {
  const links = job?.explorerLinks ?? {};
  return {
    source: approvedExplorerLink(links.source, config?.sourceExplorer, job?.sourceTransactionHash),
    settlement: approvedExplorerLink(links.settlement, config?.destinationExplorer, job?.settlementTransactionHash),
    payout: approvedExplorerLink(links.payout, config?.destinationExplorer, job?.payoutTransactionHash),
    replay: approvedExplorerLink(links.replay, config?.destinationExplorer, (job?.replayEvidence as any)?.hash),
    recovery: approvedExplorerLink(links.recovery, config?.destinationExplorer, (job?.refundRecoveryEvidence as any)?.hash),
  };
}

function semanticFailureState(state: string | undefined): boolean {
  return ['NON_PAYABLE_RESULT', 'VERIFICATION_FAILED', 'PROOF_PREFLIGHT_FAIL', 'REPLAY_REJECTED'].includes(state ?? '');
}

function staleSuccessState(state: string | undefined): boolean {
  return ['SETTLEMENT_COMPLETE', 'CLAIMABLE', 'PAYOUT_PENDING', 'CLAIMED', 'REFUNDED', 'ALREADY_SETTLED'].includes(state ?? '');
}

function policyShapeValid(policy: Record<string, any> | null): boolean {
  if (policyStateIsAbsent(policy)) return true;
  const normalized = normalizePolicyForApi(policy);
  let positiveAmount = false;
  try { positiveAmount = BigInt(String(normalized?.amount ?? '0')) > 0n; } catch { positiveAmount = false; }
  const state = Number(normalized?.state);
  const settledFieldsValid = state === 2 || state === 3
    ? Boolean(validAddress(normalized?.winner)
      && !/^0x0{40}$/i.test(String(normalized?.winner ?? ''))
      && positiveDecimal(normalized?.resultNonce)
      && nonzeroHash(normalized?.sourceQueryKey))
    : true;
  return Boolean(normalized
    && validAddress(normalized.organizer)
    && !/^0x0{40}$/i.test(String(normalized.organizer))
    && Number.isSafeInteger(normalized.sourceChainKey)
    && Number(normalized.sourceChainKey) >= 0
    && validAddress(normalized.sourceRegistry)
    && validHash(normalized.rulesHash)
    && validAddress(normalized.token)
    && positiveAmount
    && Number.isSafeInteger(normalized.settlementDeadline)
    && Number(normalized.settlementDeadline) > 0
    && Number.isSafeInteger(normalized.refundDeadline)
    && Number(normalized.refundDeadline) > Number(normalized.settlementDeadline)
    && settledFieldsValid
    && normalized.resultNonce !== null
    && validHash(normalized.sourceQueryKey));
}

function claimEvidenceComplete(job: WorkerJob | undefined): boolean {
  return Boolean(job
    && validHash(job.settlementTransactionHash)
    && job.settlementReceiptStatus === 1
    && job.resultVerified === true
    && job.tournamentSettled === true
    && validHash(job.payoutTransactionHash)
    && job.payoutReceiptStatus === 1
    && job.prizeClaimed === true);
}

function timestampFromSeconds(value: unknown): string | null {
  const numeric = Number(value);
  // Date only supports a bounded millisecond range.  Treat corrupted journal
  // timestamps as unavailable instead of allowing a RangeError to become a
  // 500 response from an otherwise read-only endpoint.
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 8_640_000_000_000) return null;
  try {
    return new Date(numeric * 1000).toISOString();
  } catch {
    return null;
  }
}

function decodePathValue(value: string): string | null {
  try { return decodeURIComponent(value); } catch { return null; }
}

function validJobId(value: string): boolean {
  return /^job-[0-9a-f]{24}$/.test(value);
}

function pathSafeManifestName(file: string, root: string): string {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : path.basename(file);
}

function envelope(job: WorkerJob | undefined, policy?: Record<string, any> | null, config?: WorkerConfig, lifecycle: Array<Record<string, unknown>> = []): LiveResponse {
  // A fresh chain read is authoritative. The journal is a recovery/evidence
  // source only and must not override an externally advanced policy.
  // `undefined` means no fresh read was attempted (for callers building a
  // local envelope); an explicit `null` means the fresh policy is absent.
  const freshPolicyRead = policy !== undefined;
  const selectedPolicyState = freshPolicyRead ? (policy ? Number(policy.state) : null) : (job?.policyState ?? null);
  const selectedPolicy = freshPolicyRead ? policy : (job?.policy ?? null);
  const inconsistentClaim = job?.state === 'CLAIMED' && !claimEvidenceComplete(job);
  const freshClaimEvidenceMissing = Boolean(policy && Number(policy.state) === 3 && !claimEvidenceComplete(job));
  // A fresh policy read can advance a normal in-flight journal record, but it
  // must not erase a terminal semantic failure already established from the
  // source/proof path. Those failures are evidence about this result, not a
  // projection of the mutable policy enum.
  const semanticFailure = Boolean(job && ['NON_PAYABLE_RESULT', 'VERIFICATION_FAILED', 'PROOF_PREFLIGHT_FAIL', 'REPLAY_REJECTED'].includes(job.state));
  const projectedProductState = inconsistentClaim || freshClaimEvidenceMissing
    ? 'UNKNOWN'
    : (semanticFailure
      ? job!.productState
      : (freshPolicyRead && !policy
        ? 'UNKNOWN'
        : (policy ? productForPolicy(selectedPolicyState) : (job?.productState ?? productForPolicy(selectedPolicyState)))));
  const productState = publicProductState(projectedProductState) ?? 'UNKNOWN';
  const projectedOutcome = inconsistentClaim || freshClaimEvidenceMissing
    ? 'UNKNOWN'
    : (semanticFailure
      ? job!.outcome
      : (freshPolicyRead && !policy ? 'UNKNOWN' : (job?.outcome ?? (selectedPolicy ? 'PASS' : 'UNKNOWN'))));
  const outcome = publicOutcome(projectedOutcome) ?? 'UNKNOWN';
  const jobState = publicJobState(job?.state);
  const jobId = typeof job?.jobId === 'string' && validJobId(job.jobId) ? job.jobId : undefined;
  return {
    schemaVersion: 1,
    dataMode: 'LIVE',
    outcome,
    jobId,
    productState,
    policyState: policyName(selectedPolicyState),
    jobState,
    source: job ? {
      chainId: publicInteger(job.sourceChainId),
      chainKey: publicInteger(job.sourceChainKey),
      registry: normalizePublicValue(job.sourceRegistry, validAddress),
      transactionHash: normalizePublicValue(job.sourceTransactionHash, validHash),
      blockNumber: publicInteger(job.sourceBlockNumber),
      blockHash: normalizePublicValue(job.sourceBlockHash, validHash),
      gasUsed: publicDecimal(job.sourceGas),
      blockTimestamp: publicIsoTimestamp(job.sourceTimestamp),
      receiptStatus: publicStatus(job.sourceReceiptStatus),
      eventSignature: job.sourceEventSignature === RPS_MATCH_FINALIZED_SIGNATURE ? RPS_MATCH_FINALIZED_SIGNATURE : null,
      tournamentId: normalizePublicValue(job.tournamentId, validHash),
      matchId: normalizePublicValue(job.matchId, validHash),
      playerOne: normalizePublicValue(job.playerOne, validAddress),
      playerTwo: normalizePublicValue(job.playerTwo, validAddress),
      winner: normalizePublicValue(job.winner, validAddress),
      result: (() => { const value = publicInteger(job.result); return value !== null && value <= 4 ? value : null; })(),
      rulesHash: normalizePublicValue(job.rulesHash, validHash),
      resultNonce: publicDecimal(job.resultNonce),
      finalizationStatus: (() => { const value = publicInteger(job.finalizationStatus); return value !== null && value <= 1 ? value : null; })(),
      deadline: timestampFromSeconds(job.sourceDeadline),
      finalizedAt: timestampFromSeconds(job.sourceFinalizedAt),
    } : null,
    attestcoin: {
      chainKey: publicInteger(job?.sourceChainKey),
      proofStatus: job ? publicProofStatus(job.proofStatus) : 'NOT_REQUESTED',
      headerNumber: publicInteger(job?.proofHeader),
      digest: normalizePublicValue(job?.proofDigest, validHash),
      cached: publicBoolean(job?.proofCached),
      latencyMs: publicInteger(job?.proofLatencyMs),
      preflight: publicOutcome(job?.proofPreflightOutcome) ?? 'UNKNOWN',
      rawProof: null,
    },
    settlement: {
      transactionHash: normalizePublicValue(job?.settlementTransactionHash, validHash),
      receiptStatus: publicStatus(job?.settlementReceiptStatus),
      blockNumber: publicInteger(job?.settlementBlock),
      gasUsed: publicDecimal(job?.settlementGas),
      blockTimestamp: publicIsoTimestamp(job?.settlementTimestamp),
      resultVerified: publicBoolean(job?.resultVerified),
      tournamentSettled: publicBoolean(job?.tournamentSettled),
      vault: normalizePublicValue(config?.vault, validAddress),
      asc: normalizePublicValue(config?.asc, validAddress),
    },
    payout: {
      transactionHash: normalizePublicValue(job?.payoutTransactionHash, validHash),
      receiptStatus: publicStatus(job?.payoutReceiptStatus),
      blockNumber: publicInteger(job?.payoutBlock),
      gasUsed: publicDecimal(job?.payoutGas),
      blockTimestamp: publicIsoTimestamp(job?.payoutTimestamp),
      prizeClaimed: publicBoolean(job?.prizeClaimed),
      winner: normalizePublicValue(selectedPolicy?.winner ?? job?.winner, validAddress),
      amount: publicDecimal(selectedPolicy?.amount),
    },
    replay: sanitizeReplayEvidence(job?.replayEvidence),
    refundRecovery: sanitizeRecoveryEvidence(job?.refundRecoveryEvidence),
    evidenceReferences: sanitizeEvidenceReferences(job?.evidenceReferences),
    explorerLinks: publicExplorerLinks(job, config),
    timestamps: {
      createdAt: publicIsoTimestamp(job?.createdAt),
      updatedAt: publicIsoTimestamp(job?.updatedAt),
      nextRetryAt: publicIsoTimestamp(job?.nextRetryAt),
    },
    retry: {
      attempts: publicCounter(job?.attemptCount),
      retries: publicCounter(job?.retryCount),
      nextRetryAt: publicIsoTimestamp(job?.nextRetryAt),
      leaseExpiresAt: publicIsoTimestamp(job?.lease?.expiresAt),
      submissionUncertainty: job?.submissionUncertainty === true,
    },
    error: inconsistentClaim
      ? { class: 'INCONSISTENT_CLAIM_EVIDENCE', message: 'CLAIMED job lacks a successful payout receipt and PrizeClaimed event evidence' }
      : freshClaimEvidenceMissing
        ? { class: 'INCONSISTENT_CLAIM_EVIDENCE', message: 'Chain policy is CLAIMED but this API instance has no matching payout receipt evidence' }
      : (job?.lastErrorClass ? sanitizeJournalError(job.lastErrorClass, job.lastErrorMessage ?? '') : null),
    lifecycle: sanitizeLifecycle(lifecycle, jobId),
  };
}

export class PrizeRailApi {
  readonly runtime: WorkerRuntime;
  readonly config: WorkerConfig;
  readonly corsOrigins: Set<string>;

  constructor(runtime: WorkerRuntime, config = runtime.config) {
    this.runtime = runtime;
    this.config = config;
    this.corsOrigins = new Set((process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean));
  }

  private publicConfig(): Record<string, unknown> {
    const configuration = this.runtime.getConfigurationCheck();
    return {
      schemaVersion: 1,
      dataMode: 'LIVE',
      outcome: configuration.outcome,
      readiness: configuration,
      protocolVersion: boundedPublicText(this.config.manifest.protocolVersion) ?? 'UNKNOWN',
      source: { chainId: publicInteger(this.config.sourceChainId), chainKey: publicInteger(this.config.sourceChainKey), registry: normalizePublicValue(this.config.sourceRegistry, validAddress), deploymentBlock: publicInteger(this.config.sourceDeploymentBlock), explorerBase: publicExplorerBase(this.config.sourceExplorer) },
      destination: { chainId: publicInteger(this.config.destinationChainId), token: normalizePublicValue(this.config.token, validAddress), vault: normalizePublicValue(this.config.vault, validAddress), asc: normalizePublicValue(this.config.asc, validAddress), deploymentBlock: publicInteger(this.config.destinationDeploymentBlock), explorerBase: publicExplorerBase(this.config.destinationExplorer) },
      attestcoin: { expectedBlockProver: normalizePublicValue(this.config.expectedBlockProver, validAddress), expectedChainInfo: normalizePublicValue(this.config.expectedChainInfo, validAddress) },
      features: { watcherDiscovery: true, automaticClaim: this.config.autoClaim, mutations: false, rawProofInApi: false },
      deployment: { selector: 'evidence/current-deployment.json', manifest: pathSafeManifestName(this.config.deploymentFile, this.config.root) },
    };
  }

  private async policy(tournamentId: string): Promise<Record<string, any>> {
    return asPolicy(await (this.runtime.vault as any).policies(tournamentId));
  }

  private async derivedPolicy(policy: Record<string, any> | null): Promise<{ state: string | null; evidence: Record<string, unknown> | null }> {
    if (policyStateIsAbsent(policy)) return { state: null, evidence: null };
    if (Number(policy?.state) !== 1) return { state: policyName(Number(policy?.state)), evidence: null };
    try {
      const latest = await this.runtime.destinationProvider.getBlock('latest');
      if (!latest) return { state: 'FUNDED', evidence: { outcome: 'UNKNOWN', settlementDeadline: policy?.settlementDeadline ?? null, refundDeadline: policy?.refundDeadline ?? null } };
      // Block timestamps are an untrusted RPC boundary.  A malformed value
      // must not fall through both deadline comparisons and look like a
      // healthy funded policy (NaN makes both comparisons false).
      const rawTimestamp = latest.timestamp;
      const timestamp = typeof rawTimestamp === 'bigint'
        ? (rawTimestamp >= 0n && rawTimestamp <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rawTimestamp) : Number.NaN)
        : typeof rawTimestamp === 'number'
          ? rawTimestamp
          : typeof rawTimestamp === 'string' && /^\d+$/.test(rawTimestamp)
            ? Number(rawTimestamp)
            : Number.NaN;
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
        return { state: 'FUNDED', evidence: { outcome: 'UNKNOWN', settlementDeadline: policy?.settlementDeadline ?? null, refundDeadline: policy?.refundDeadline ?? null } };
      }
      if (timestamp > Number(policy?.refundDeadline)) return { state: 'RECOVERY_AVAILABLE', evidence: { outcome: 'PASS', beneficiary: policy?.organizer ?? null, trigger: 'permissionless', settlementDeadline: policy?.settlementDeadline ?? null, refundDeadline: policy?.refundDeadline ?? null } };
      if (timestamp > Number(policy?.settlementDeadline)) return { state: 'REFUND_AVAILABLE', evidence: { outcome: 'PASS', beneficiary: policy?.organizer ?? null, trigger: 'organizer', settlementDeadline: policy?.settlementDeadline ?? null, refundDeadline: policy?.refundDeadline ?? null } };
      return { state: 'FUNDED', evidence: { outcome: 'PASS', settlementDeadline: policy?.settlementDeadline ?? null, refundDeadline: policy?.refundDeadline ?? null } };
    } catch (error) {
      return { state: 'FUNDED', evidence: { outcome: 'UNKNOWN', error: { class: 'RPC_UNAVAILABLE', message: safeError(error) }, settlementDeadline: policy?.settlementDeadline ?? null, refundDeadline: policy?.refundDeadline ?? null } };
    }
  }

  private json(response: http.ServerResponse, status: number, body: unknown, origin?: string): void {
    if (origin && this.corsOrigins.has(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.statusCode = status;
    response.end(JSON.stringify(body));
  }

  private validTournament(value: string): boolean { return /^0x[0-9a-f]{64}$/.test(value); }

  private async route(method: string, pathname: string): Promise<{ status: number; body: unknown }> {
    if (method !== 'GET') return { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'read-only API; no mutation endpoint is enabled' } } };
    if (pathname === '/api/v1/live') {
      return { status: 200, body: { schemaVersion: 1, scope: 'API_PROCESS_ONLY', outcome: 'PASS' } };
    }
    if (pathname === '/api/v1/health') {
      const health = await this.runtime.health();
      const checks = Object.values(health).filter((value) => value && typeof value === 'object' && 'outcome' in value) as Array<{ outcome: string }>;
      const outcome = checks.some((check) => check.outcome === 'FAIL') ? 'FAIL' : checks.some((check) => check.outcome === 'UNKNOWN') ? 'UNKNOWN' : 'PASS';
      return { status: outcome === 'PASS' ? 200 : 503, body: { schemaVersion: 1, dataMode: 'LIVE', outcome, api: { outcome: 'PASS' }, dependencies: health } };
    }
    if (pathname === '/api/v1/config') return { status: 200, body: this.publicConfig() };
    const proofMatch = pathname.match(/^\/api\/v1\/proof-jobs\/([^/]+)$/);
    if (proofMatch) {
      await this.runtime.store.refresh();
      const jobId = decodePathValue(proofMatch[1]);
      if (jobId === null) return { status: 400, body: { error: { code: 'INVALID_INPUT', message: 'jobId encoding is invalid' } } };
      if (!validJobId(jobId)) return { status: 400, body: { error: { code: 'INVALID_INPUT', message: 'jobId format is invalid' } } };
      const job = this.runtime.store.getJob(jobId);
      if (!job) return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'proof job not found' } } };
      let policy: Record<string, any> | null = null;
      let policyAbsent = false;
      let policyReadError: { class: string; message: string } | null = null;
      try {
        policy = await this.policy(job.tournamentId);
        policyAbsent = policyStateIsAbsent(policy);
        if (policyAbsent) policy = null;
        else if (!policyShapeValid(policy)) {
          policy = null;
          policyReadError = { class: 'UNKNOWN', message: 'destination policy response is malformed' };
        } else {
          const bindingError = policyBindingError(policy, job, this.config);
          if (bindingError) {
            policy = null;
            policyReadError = bindingError;
          }
        }
      } catch (error) {
        policyReadError = { class: 'RPC_UNAVAILABLE', message: safeError(error) };
      }
      const body = envelope(job, policy, this.config, this.runtime.store.getTransitions(job.jobId) as unknown as Array<Record<string, unknown>>);
      if (policyReadError) {
        const infrastructure = policyReadIsInfrastructure(policyReadError);
        body.outcome = infrastructure ? 'UNKNOWN' : 'FAIL';
        body.productState = infrastructure ? 'INFRASTRUCTURE_UNAVAILABLE' : 'UNKNOWN';
        body.policyState = null;
        body.error = policyReadError;
      } else if (policyAbsent && !semanticFailureState(job.state)) {
        // A zero/absent fresh policy invalidates any stale journal projection;
        // never report a previously claimed or funded job as successful when
        // the destination chain no longer contains its policy.
        body.outcome = 'UNKNOWN';
        body.productState = staleSuccessState(job.state) ? 'UNKNOWN' : 'WAITING_FOR_POLICY';
        body.policyState = null;
        body.error = { class: 'POLICY_NOT_FOUND', message: 'matching CC3 policy is not present on the destination chain' };
      }
      const derived = await this.derivedPolicy(policy);
      if (derived.evidence?.outcome === 'UNKNOWN' && !policyReadError) {
        body.outcome = 'UNKNOWN';
        body.error = { class: 'RPC_UNAVAILABLE', message: 'policy deadline state could not be derived from the destination chain' };
      }
      if (!policyReadError && ['MINED', 'WAITING_FOR_POLICY', 'INFRASTRUCTURE_UNAVAILABLE', 'UNKNOWN'].includes(job.state)) body.productState = derived.state ?? body.productState;
      body.refundRecovery = sanitizeRecoveryEvidence(derived.evidence) ?? body.refundRecovery;
      return { status: policyReadIsInfrastructure(policyReadError) ? 503 : 200, body };
    }
    const tournamentMatch = pathname.match(/^\/api\/v1\/tournaments\/([^/]+)(?:\/(status|evidence))?$/);
    if (tournamentMatch) {
      await this.runtime.store.refresh();
      const decodedTournament = decodePathValue(tournamentMatch[1]);
      if (decodedTournament === null) return { status: 400, body: { error: { code: 'INVALID_INPUT', message: 'tournamentId encoding is invalid' } } };
      const tournamentId = normalizeHex(decodedTournament);
      if (!this.validTournament(tournamentId)) return { status: 400, body: { error: { code: 'INVALID_INPUT', message: 'tournamentId must be a 32-byte hex value' } } };
      const job = this.runtime.store.getJobByTournament(tournamentId);
      let policy: Record<string, any> | null = null;
      let policyAbsent = false;
      let policyReadError: { class: string; message: string } | null = null;
      try {
        policy = await this.policy(tournamentId);
        policyAbsent = policyStateIsAbsent(policy);
        if (policyAbsent) policy = null;
        else if (!policyShapeValid(policy)) {
          policy = null;
          policyReadError = { class: 'UNKNOWN', message: 'destination policy response is malformed' };
        } else {
          const bindingError = policyBindingError(policy, job, this.config);
          if (bindingError) {
            policy = null;
            policyReadError = bindingError;
          }
        }
      } catch (error) {
        policyReadError = { class: 'RPC_UNAVAILABLE', message: safeError(error) };
      }
      const body = envelope(job, policy, this.config, job ? this.runtime.store.getTransitions(job.jobId) as unknown as Array<Record<string, unknown>> : []);
      if (policyReadError) {
        const infrastructure = policyReadIsInfrastructure(policyReadError);
        body.outcome = infrastructure ? 'UNKNOWN' : 'FAIL';
        body.productState = infrastructure ? 'INFRASTRUCTURE_UNAVAILABLE' : 'UNKNOWN';
        body.policyState = null;
        body.error = policyReadError;
      } else if (policyAbsent && job && !semanticFailureState(job.state)) {
        body.outcome = 'UNKNOWN';
        body.productState = staleSuccessState(job.state) ? 'UNKNOWN' : 'WAITING_FOR_POLICY';
        body.policyState = null;
        body.error = { class: 'POLICY_NOT_FOUND', message: 'matching CC3 policy is not present on the destination chain' };
      }
      const derived = await this.derivedPolicy(policy);
      if (derived.evidence?.outcome === 'UNKNOWN' && !policyReadError) {
        body.outcome = 'UNKNOWN';
        body.error = { class: 'RPC_UNAVAILABLE', message: 'policy deadline state could not be derived from the destination chain' };
      }
      if (!job || ['MINED', 'WAITING_FOR_POLICY', 'INFRASTRUCTURE_UNAVAILABLE', 'UNKNOWN'].includes(job.state)) body.productState = derived.state ?? body.productState;
      body.refundRecovery = sanitizeRecoveryEvidence(derived.evidence) ?? body.refundRecovery;
      const publicPolicy = normalizePolicyForApi(policy);
      const responseStatus = policyReadIsInfrastructure(policyReadError) ? 503 : 200;
      if (tournamentMatch[2] === 'evidence') return { status: responseStatus, body: { ...body, policy: publicPolicy } };
      if (tournamentMatch[2] === 'status') return { status: responseStatus, body };
      return { status: responseStatus, body: { ...body, policy: publicPolicy, jobId: job?.jobId ?? null } };
    }
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'route not found' } } };
  }

  createServer(): http.Server {
    return http.createServer(async (request, response) => {
      const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
      if (request.method === 'OPTIONS') {
        if (origin && this.corsOrigins.has(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
        response.statusCode = 204;
        response.end();
        return;
      }
      try {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const result = await this.route(request.method ?? 'GET', url.pathname);
        this.json(response, result.status, result.body, origin);
      } catch (error) {
        this.json(response, 500, { error: { code: 'INTERNAL_ERROR', message: safeError(error) } }, origin);
      }
    });
  }

  async listen(port = Number(process.env.PORT ?? 3000), host = process.env.HOST ?? '127.0.0.1'): Promise<http.Server> {
    const server = this.createServer();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve()); });
    const address = server.address() as AddressInfo;
    console.log(JSON.stringify({ event: 'api_started', host: address.address, port: address.port, basePath: '/api/v1' }));
    return server;
  }
}

export function createConfigurationFailureServer(error: unknown): http.Server {
  const message = safeError(error);
  return http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.statusCode = 503;
    response.end(JSON.stringify({ schemaVersion: 1, dataMode: 'LIVE', outcome: 'FAIL', error: { code: 'INVALID_CONFIGURATION', message } }));
  });
}

export {
  envelope,
  policyName,
  sanitizeEvidenceReferences,
  sanitizeLifecycle,
  sanitizeRecoveryEvidence,
  sanitizeReplayEvidence,
};
