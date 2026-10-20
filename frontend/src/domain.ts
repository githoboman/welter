export type DataMode = 'LIVE' | 'HISTORICAL_VERIFIED_RUN' | 'DEVELOPMENT_FIXTURE';
export type EvidenceOutcome = 'PASS' | 'FAIL' | 'UNKNOWN';

export type WalletStatus = 'UNAVAILABLE' | 'DISCONNECTED' | 'CONNECTING' | 'SWITCHING' | 'CONNECTED' | 'ERROR';
export type WalletNetwork = 'BOT_CHAIN_TESTNET' | 'BOT_CHAIN_MAINNET' | 'WRONG_NETWORK' | 'UNKNOWN';

export interface WalletSnapshot {
  status: WalletStatus;
  providerPresent: boolean;
  address: string | null;
  chainId: number | null;
  chainName: string;
  network: WalletNetwork;
  error: { code: string; message: string } | null;
}

export type PolicyState = 'DRAFT' | 'FUNDED' | 'CLAIMABLE' | 'CLAIMED' | 'REFUNDED';
export type ProductState =
  | 'MATCH_PENDING'
  | 'MATCH_ACTIVE'
  | 'MATCH_FINALIZED'
  | 'MATCH_FINALIZATION_BLOCKED'
  | 'MATCH_TIMEOUT_FINALIZABLE'
  | 'MINED'
  | 'AWAITING_ATTESTATION'
  | 'PROOF_READY'
  | 'PROOF_PREFLIGHT_PASS'
  | 'PROOF_PREFLIGHT_FAIL'
  | 'ATTESTATION_VERIFIED'
  | 'SUBMITTING'
  | 'SETTLEMENT_PENDING'
  | 'SETTLEMENT_COMPLETE'
  | 'CLAIMABLE'
  | 'PAYOUT_PENDING'
  | 'PAYOUT_COMPLETE'
  | 'CLAIMED'
  | 'REFUND_AVAILABLE'
  | 'RECOVERY_AVAILABLE'
  | 'REFUNDED'
  | 'NON_PAYABLE_RESULT'
  | 'VERIFICATION_FAILED'
  | 'REPLAY_REJECTED'
  | 'ALREADY_SETTLED'
  | 'INFRASTRUCTURE_UNAVAILABLE'
  | 'UNKNOWN';

export interface ExplorerLinks {
  source?: string;
  settlement?: string;
  payout?: string;
  replay?: string;
  recovery?: string;
}

export interface HistoricalTransaction {
  hash: string;
  blockNumber: number;
  gasUsed: string;
}

export interface HistoricalRunEvidence {
  runId: string;
  mode: string;
  deployment: { manifest: string; protocolVersion: string };
  source: {
    chainId: number;
    chainKey: number;
    registry: string;
    transaction: HistoricalTransaction;
    decoded: {
      tournamentId: string;
      matchId: string;
      playerOne: string;
      playerTwo: string;
      winner: string;
      result: number;
      rulesHash: string;
      resultNonce: string;
      finalizationStatus: number;
      sourceChainId: string | number;
      finalizedAt: string | number;
      deadline: string | number;
    };
    steps: HistoricalTransaction[];
  };
  destination: {
    chainId: number;
    amount: string;
    token: string;
    vault: string;
    asc: string;
    funding: HistoricalTransaction[];
    settlement: HistoricalTransaction;
    payout: HistoricalTransaction;
    finalState: number;
    winnerBalance: string;
  };
  attestation: {
    proofIdentifier: string;
    proofCached: boolean;
    headerNumber: number;
    verified: boolean;
    latencyMs: number;
  };
  replay: {
    rejected: boolean;
    hash: string;
    blockNumber: number;
    gasUsed: string;
    status: number;
    error: string;
  };
  timing: {
    sourceBlockTimestamp: number;
    settlementBlockTimestamp: number;
    sourceToSettlementSeconds: number;
  };
  explorers: ExplorerLinks;
  wallets: Record<string, string>;
}

export interface RecoveryEvidence {
  mode: string;
  protocolVersion: string;
  deployment: { manifest: string };
  tournamentId: string;
  deadlines: { settlementDeadline: number; refundDeadline: number };
  organizer: string;
  trigger: string;
  funding: { amount: string; vaultBalanceBeforeRecovery: string };
  recovery: {
    hash: string;
    blockNumber: number;
    gasUsed: string;
    state: number;
    organizerBalanceIncrease: string;
  };
  settlementBlockedByState: boolean;
  explorers: ExplorerLinks;
}

export interface DataResult<T> {
  mode: DataMode;
  outcome: EvidenceOutcome;
  data?: T;
  source: string;
  message?: string;
}

export interface LiveResponse {
  schemaVersion: 1;
  dataMode: 'LIVE';
  outcome: EvidenceOutcome;
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
  jobId?: string | null;
  lifecycle?: Array<Record<string, unknown>>;
  policy?: Record<string, unknown> | null;
}

export interface ApiHealthResponse {
  schemaVersion: 1;
  dataMode: 'LIVE';
  outcome: EvidenceOutcome;
  api?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

export interface DeploymentConfig {
  protocolVersion: string;
  generatedAt: string;
  source: {
    chainId: number;
    chainKey: number;
    contract: string;
    finalizer: string;
    deploymentTx: string;
    deploymentBlock: number;
    rulesHash: string;
  };
  destination: {
    chainId: number;
    settlementWorker: string;
    token: { address: string; deploymentTx: string; deploymentBlock: number };
    vault: { address: string; deploymentTx: string; deploymentBlock: number };
    asc: { address: string; deploymentTx: string; deploymentBlock: number };
    expectedBlockProver: string;
    expectedChainInfo: string;
  };
}

export interface PrizeRailRepository {
  getHistoricalRun(): Promise<DataResult<HistoricalRunEvidence>>;
  getRecoveryEvidence(): Promise<DataResult<RecoveryEvidence>>;
  getDeployment(): Promise<DataResult<DeploymentConfig>>;
  getLiveEvidence(tournamentId: string): Promise<DataResult<LiveResponse>>;
  getLiveStatus(tournamentId: string): Promise<DataResult<LiveResponse>>;
  getApiHealth(): Promise<DataResult<ApiHealthResponse>>;
}

export interface FlowStage {
  id: ProductState;
  label: string;
  description: string;
  authority: string;
  mode: DataMode;
}
