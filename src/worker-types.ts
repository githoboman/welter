import type { RpsMatchResult } from './adapter.js';

export type Outcome = 'PASS' | 'FAIL' | 'UNKNOWN';

export type JobState =
  | 'DISCOVERED'
  | 'WAITING_FOR_POLICY'
  | 'MINED'
  | 'AWAITING_ATTESTATION'
  | 'PROOF_READY'
  | 'PROOF_PREFLIGHT_PASS'
  | 'PROOF_PREFLIGHT_FAIL'
  | 'SUBMITTING'
  | 'SETTLEMENT_PENDING'
  | 'SETTLEMENT_COMPLETE'
  | 'CLAIMABLE'
  | 'PAYOUT_PENDING'
  | 'CLAIMED'
  | 'REFUNDED'
  | 'NON_PAYABLE_RESULT'
  | 'VERIFICATION_FAILED'
  | 'REPLAY_REJECTED'
  | 'ALREADY_SETTLED'
  | 'INFRASTRUCTURE_UNAVAILABLE'
  | 'UNKNOWN';

/** Identifies which broadcast may be uncertain when the public state is stale. */
export type SubmissionPhase = 'SETTLEMENT' | 'PAYOUT';

export type ErrorClass =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_INPUT'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_FAILED'
  | 'WRONG_SOURCE_CHAIN'
  | 'WRONG_SOURCE_REGISTRY'
  | 'WRONG_EVENT'
  | 'WRONG_TOURNAMENT'
  | 'WRONG_RULES'
  | 'WRONG_WINNER'
  | 'INVALID_NONCE'
  | 'INVALID_RESULT'
  | 'POLICY_NOT_FOUND'
  | 'POLICY_NOT_FUNDED'
  | 'POLICY_EXPIRED'
  | 'POLICY_REFUNDED'
  | 'ALREADY_SETTLED'
  | 'REPLAYED'
  | 'PROVER_UNAVAILABLE'
  | 'RPC_UNAVAILABLE'
  | 'MALFORMED_PROOF'
  | 'PROOF_REJECTED'
  | 'SEMANTIC_REJECTION'
  | 'PERSISTENCE_FAILURE'
  | 'UNKNOWN';

export interface Lease {
  owner: string;
  expiresAt: string;
}

export interface TxEvidence {
  hash: string;
  status: number | null;
  blockNumber: number | null;
  gasUsed: string | null;
  timestamp?: string | null;
  explorer?: string | null;
}

export interface EventObservation {
  sourceChainId: number;
  sourceChainKey: number;
  transactionHash: string;
  blockNumber: number;
  blockHash?: string | null;
  registry: string;
  eventSignature: string;
  receiptStatus: number | null;
  observedAt: string;
}

export interface WorkerJob {
  schemaVersion: 1;
  jobId: string;
  sourceChainId: number;
  sourceChainKey: number;
  sourceTransactionHash: string;
  sourceBlockNumber: number;
  sourceBlockHash: string | null;
  sourceGas: string | null;
  sourceTimestamp: string | null;
  sourceRegistry: string;
  sourceEventSignature: string;
  tournamentId: string;
  matchId: string;
  playerOne: string;
  playerTwo: string;
  winner: string;
  result: number;
  rulesHash: string;
  resultNonce: string;
  finalizationStatus: number;
  sourceDeadline: string;
  sourceFinalizedAt: string;
  sourceReceiptStatus: number | null;
  state: JobState;
  productState: JobState;
  dataMode: 'LIVE';
  outcome: Outcome;
  evidenceOutcome: Outcome;
  attemptCount: number;
  retryCount: number;
  nextRetryAt: string | null;
  lease: Lease | null;
  createdAt: string;
  updatedAt: string;
  proofStatus: 'NOT_REQUESTED' | 'PENDING' | 'AVAILABLE' | 'PREFLIGHT_PASS' | 'PREFLIGHT_FAIL' | 'UNKNOWN';
  proofHeader: number | null;
  proofDigest: string | null;
  proofCached: boolean | null;
  proofLatencyMs: number | null;
  proofPreflightOutcome: Outcome;
  settlementTransactionHash: string | null;
  settlementReceiptStatus: number | null;
  settlementBlock: number | null;
  settlementGas: string | null;
  settlementTimestamp: string | null;
  payoutTransactionHash: string | null;
  /** Set when a process may have broadcast but lost the transaction hash. */
  submissionUncertainty?: boolean;
  /** Durable phase marker for crash recovery when state alone is ambiguous. */
  submissionPhase?: SubmissionPhase;
  payoutReceiptStatus: number | null;
  payoutBlock: number | null;
  payoutGas: string | null;
  payoutTimestamp: string | null;
  replayEvidence: Record<string, unknown> | null;
  refundRecoveryEvidence: Record<string, unknown> | null;
  policyState: number | null;
  policy: Record<string, string | number> | null;
  resultVerified: boolean | null;
  tournamentSettled: boolean | null;
  prizeClaimed: boolean | null;
  explorerLinks: Record<string, string | null>;
  lastErrorClass: ErrorClass | null;
  lastErrorMessage: string | null;
  evidenceReferences: string[];
}

export interface Cursor {
  schemaVersion: 1;
  nextBlock: number;
  lastScannedBlock: number | null;
  updatedAt: string;
}

export interface Transition {
  at: string;
  jobId: string;
  from: JobState | null;
  to: JobState;
  reason: string;
}

export interface WorkerHeartbeat {
  owner: string;
  at: string;
}

export interface StoreState {
  schemaVersion: 1;
  cursor: Cursor;
  jobs: Record<string, WorkerJob>;
  sourceIndex: Record<string, string>;
  tournamentIndex: Record<string, string>;
  businessIndex: Record<string, string>;
  settlementIndex: Record<string, string>;
  payoutIndex: Record<string, string>;
  observations: Record<string, EventObservation>;
  transitions: Transition[];
  workerHeartbeat: WorkerHeartbeat | null;
}

export type AdmissionResult =
  | { kind: 'ACCEPTED'; policy: Record<string, string | number> }
  | { kind: 'WAITING_FOR_POLICY'; errorClass: ErrorClass; message: string }
  | { kind: 'NON_PAYABLE_RESULT'; message: string }
  | { kind: 'PERMANENT_FAILURE'; errorClass: ErrorClass; message: string }
  | { kind: 'ALREADY_SETTLED'; policyState: number; policy: Record<string, string | number> }
  | { kind: 'REFUNDED'; policyState: number; policy: Record<string, string | number> }
  | { kind: 'INFRASTRUCTURE_UNAVAILABLE'; errorClass: ErrorClass; message: string };

export function normalizeHex(value: string): string {
  return value.toLowerCase();
}

export function sourceIdentity(sourceChainId: number, txHash: string): string {
  return `${sourceChainId}:${normalizeHex(txHash)}`;
}

export function businessIdentity(tournamentId: string, resultNonce: string): string {
  return `${normalizeHex(tournamentId)}:${String(resultNonce)}`;
}

export function resultToJobFields(result: RpsMatchResult): Pick<WorkerJob, 'tournamentId' | 'matchId' | 'playerOne' | 'playerTwo' | 'winner' | 'result' | 'rulesHash' | 'resultNonce' | 'finalizationStatus' | 'sourceDeadline' | 'sourceFinalizedAt'> {
  return {
    tournamentId: normalizeHex(result.tournamentId),
    matchId: normalizeHex(result.matchId),
    playerOne: normalizeHex(result.playerOne),
    playerTwo: normalizeHex(result.playerTwo),
    winner: normalizeHex(result.winner),
    result: result.result,
    rulesHash: normalizeHex(result.rulesHash),
    resultNonce: String(result.resultNonce),
    finalizationStatus: result.finalizationStatus,
    sourceDeadline: String(result.deadline),
    sourceFinalizedAt: String(result.finalizedAt),
  };
}
