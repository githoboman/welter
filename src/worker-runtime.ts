import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AbiCoder,
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  id,
  keccak256,
  ZeroAddress,
} from 'ethers';
import { blockProver, chainInfo } from '@gluwa/usc-sdk';
import { getAttestcoinProof, type ProofData } from './attestcoin.js';
import { proofToQuery, rpsMatchFinalizedAdapter, RPS_MATCH_FINALIZED_SIGNATURE } from './adapter.js';
import { assertAddress, loadDeploymentManifest, roleKey, type DeploymentManifest } from './deployment.js';
import { DurableStore, isTerminalState } from './durable-store.js';
import type { AdmissionResult, ErrorClass, JobState, SubmissionPhase, WorkerJob } from './worker-types.js';
import { normalizeHex, resultToJobFields } from './worker-types.js';

const SOURCE_CHAIN_ID = 11155111;
const DESTINATION_CHAIN_ID = 102031;
const DEFAULT_SOURCE_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const DEFAULT_DESTINATION_RPC = 'https://rpc.cc3-testnet.creditcoin.network';
const DEFAULT_PROVER_URL = 'https://prover.cc3-testnet.creditcoin.network';
const BLOCK_PROVER = '0x0000000000000000000000000000000000000fd2';
const CHAIN_INFO = '0x0000000000000000000000000000000000000fd3';
const HEALTH_PROBE_TIMEOUT_MS = 10_000;

const REGISTRY_ABI = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'artifacts', 'TournamentResultRegistry.json'), 'utf8')).abi;
const VAULT_ABI = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'artifacts', 'PrizeVault.json'), 'utf8')).abi;
const ASC_ABI = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'artifacts', 'PrizeRailASC.json'), 'utf8')).abi;

export interface WorkerConfig {
  root: string;
  sourceRpc: string;
  destinationRpc: string;
  proverUrl: string;
  sourceChainId: number;
  destinationChainId: number;
  sourceChainKey: number;
  sourceRegistry: string;
  sourceFinalizer: string;
  sourceDeploymentBlock: number;
  sourceStartBlock: number;
  destinationDeploymentBlock: number;
  token: string;
  vault: string;
  asc: string;
  expectedBlockProver: string;
  expectedChainInfo: string;
  workerPrivateKey?: string;
  autoClaim: boolean;
  confirmations: number;
  batchSize: number;
  pollIntervalMs: number;
  maxAttempts: number;
  leaseTtlMs: number;
  reorgRewind: number;
  dataDirectory: string;
  sourceExplorer: string;
  destinationExplorer: string;
  deploymentFile: string;
  manifest: DeploymentManifest;
}

export interface ConfigurationCheck {
  outcome: 'PASS' | 'FAIL' | 'UNKNOWN';
  message?: string;
}

export interface WorkerHealth {
  api: ConfigurationCheck;
  configuration: ConfigurationCheck;
  persistence: ConfigurationCheck;
  sourceRpc: ConfigurationCheck;
  sourceDiscovery: ConfigurationCheck;
  destinationRpc: ConfigurationCheck;
  chainInfo: ConfigurationCheck;
  proofService: ConfigurationCheck;
  workerLoop: ConfigurationCheck & { running: boolean; lastLoopAt: string | null };
}

function loadEnvFile(root: string): void {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

function env(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is required`);
}

function integerEnv(name: string, fallback: number, minimum = 0): number {
  const value = Number(process.env[name]?.trim() || fallback);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be a safe integer >= ${minimum}`);
  return value;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = (process.env[name]?.trim() || String(fallback)).toLowerCase();
  if (!['1', '0', 'true', 'false', 'yes', 'no'].includes(raw)) throw new Error(`${name} must be true or false`);
  return ['1', 'true', 'yes'].includes(raw);
}

async function boundedProbe<T>(operation: PromiseLike<T>, label: string, timeoutMs = HEALTH_PROBE_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} probe timed out`)), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function loadWorkerConfig(root = process.cwd()): WorkerConfig {
  loadEnvFile(root);
  const { manifest, file } = loadDeploymentManifest(root);
  if (manifest.protocolVersion !== 'post-fix-v2') throw new Error(`worker requires post-fix-v2 deployment, got ${manifest.protocolVersion ?? 'UNKNOWN'}`);
  if (manifest.source.chainId !== SOURCE_CHAIN_ID || manifest.destination.chainId !== DESTINATION_CHAIN_ID) throw new Error('deployment manifest network IDs do not match the MVP networks');
  const sourceStartBlock = integerEnv('WORKER_SOURCE_START_BLOCK', manifest.source.deploymentBlock, 0);
  if (sourceStartBlock < manifest.source.deploymentBlock) throw new Error('WORKER_SOURCE_START_BLOCK cannot precede source deployment block');
  const chainKey = integerEnv('ATTESTCOIN_SOURCE_CHAIN_KEY', manifest.source.chainKey, 0);
  if (manifest.source.chainKey !== chainKey || chainKey !== 1) throw new Error('ATTESTCOIN_SOURCE_CHAIN_KEY and manifest source chain key must both be 1 for Ethereum Sepolia');
  const expectedBlockProver = env('ATTESTCOIN_BLOCK_PROVER_ADDRESS', manifest.destination.expectedBlockProver).toLowerCase();
  const expectedChainInfo = env('ATTESTCOIN_CHAIN_INFO_ADDRESS', manifest.destination.expectedChainInfo).toLowerCase();
  if (expectedBlockProver !== manifest.destination.expectedBlockProver.toLowerCase() || expectedChainInfo !== manifest.destination.expectedChainInfo.toLowerCase()) throw new Error('configured Attestcoin precompile addresses do not match the selected deployment');
  return {
    root,
    sourceRpc: env('SEPOLIA_RPC_URL', DEFAULT_SOURCE_RPC),
    destinationRpc: env('CREDITCOIN_RPC_URL', DEFAULT_DESTINATION_RPC),
    proverUrl: env('ATTESTCOIN_PROVER_URL', DEFAULT_PROVER_URL),
    sourceChainId: SOURCE_CHAIN_ID,
    destinationChainId: DESTINATION_CHAIN_ID,
    sourceChainKey: chainKey,
    sourceRegistry: manifest.source.contract.toLowerCase(),
    sourceFinalizer: (manifest.source.finalizer ?? manifest.source.deployer).toLowerCase(),
    sourceDeploymentBlock: manifest.source.deploymentBlock,
    sourceStartBlock,
    destinationDeploymentBlock: Math.min(manifest.destination.token.deploymentBlock, manifest.destination.vault.deploymentBlock, manifest.destination.asc.deploymentBlock),
    token: manifest.destination.token.address.toLowerCase(),
    vault: manifest.destination.vault.address.toLowerCase(),
    asc: manifest.destination.asc.address.toLowerCase(),
    expectedBlockProver,
    expectedChainInfo,
    workerPrivateKey: roleKey('worker', false),
    autoClaim: booleanEnv('WORKER_AUTO_CLAIM', false),
    confirmations: integerEnv('WORKER_CONFIRMATIONS', 1, 0),
    batchSize: integerEnv('WORKER_BATCH_SIZE', 100, 1),
    pollIntervalMs: integerEnv('WORKER_POLL_INTERVAL_MS', 15_000, 100),
    maxAttempts: integerEnv('WORKER_MAX_ATTEMPTS', 12, 1),
    leaseTtlMs: integerEnv('WORKER_LEASE_TTL_MS', 60_000, 1_000),
    reorgRewind: integerEnv('WORKER_REORG_REWIND', 6, 0),
    dataDirectory: path.resolve(root, env('PRIZERAIL_DATA_DIR', '.data/prizerail')),
    sourceExplorer: env('NEXT_PUBLIC_SEPOLIA_EXPLORER_URL', 'https://sepolia.etherscan.io').replace(/\/$/, ''),
    destinationExplorer: env('NEXT_PUBLIC_CREDITCOIN_EXPLORER_URL', 'https://creditcoin-testnet.blockscout.com').replace(/\/$/, ''),
    deploymentFile: file,
    manifest,
  };
}

function asPolicy(raw: any): Record<string, string | number> {
  return {
    organizer: normalizeHex(String(raw.organizer ?? raw[0] ?? ZeroAddress)),
    sourceChainKey: Number(raw.sourceChainKey ?? raw[1]),
    sourceRegistry: normalizeHex(String(raw.sourceRegistry ?? raw[2] ?? ZeroAddress)),
    rulesHash: normalizeHex(String(raw.rulesHash ?? raw[3] ?? '0x')),
    token: normalizeHex(String(raw.token ?? raw[4] ?? ZeroAddress)),
    amount: String(raw.amount ?? raw[5] ?? 0),
    settlementDeadline: Number(raw.settlementDeadline ?? raw[6] ?? 0),
    refundDeadline: Number(raw.refundDeadline ?? raw[7] ?? 0),
    winner: normalizeHex(String(raw.winner ?? raw[8] ?? ZeroAddress)),
    resultNonce: String(raw.resultNonce ?? raw[9] ?? 0),
    sourceQueryKey: normalizeHex(String(raw.sourceQueryKey ?? raw[10] ?? '0x')),
    state: Number(raw.state ?? raw[11] ?? 0),
  };
}

function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    // Provider errors may echo keyed endpoints, credentials, or local paths.
    // Keep only a short diagnostic suitable for logs and the public API.
    .replace(/(?:[a-z][a-z0-9+.-]*):\/\/[^\s]+/gi, '[url-redacted]')
    // Redact paths at ordinary word boundaries and after assignment-like
    // delimiters (for example `path=/srv/worker/.env`).
    .replace(/(^|[\s'\"=:(])(?:[A-Za-z]:[\\/]|\/)(?:[^\s'\",;)]*)/g, '$1[path-redacted]')
    .replace(/(?:PRIVATE_KEY|SESSION_SECRET|DATABASE_URL|API_KEY|TOKEN)=?[^\s,;]*/gi, '[secret-redacted]')
    .replace(/(https?:\/\/)[^\s]+/gi, '$1[redacted]')
    .replace(/0x[a-fA-F0-9]{40,}/g, '[hex-redacted]')
    .replace(/[a-fA-F0-9]{80,}/g, '[hex-redacted]')
    .slice(0, 320);
}

function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }));
}

function classifyError(error: unknown): { errorClass: ErrorClass; retryable: boolean; message: string } {
  const message = safeError(error);
  const lower = message.toLowerCase();
  // Transport signals take precedence over semantic words that may appear in
  // an RPC error (for example, "chain key" in a timeout response).
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('socket') || lower.includes('fetch') || lower.includes('econn') || lower.includes('rpc')) return { errorClass: 'RPC_UNAVAILABLE', retryable: true, message };
  if (lower.includes('wrongchain') || lower.includes('chain key') || lower.includes('network does not match') || lower.includes('chain id mismatch')) return { errorClass: 'WRONG_SOURCE_CHAIN', retryable: false, message };
  if (lower.includes('wrongsource') || lower.includes('registry')) return { errorClass: 'WRONG_SOURCE_REGISTRY', retryable: false, message };
  if (lower.includes('wrongrules')) return { errorClass: 'WRONG_RULES', retryable: false, message };
  if (lower.includes('wrongwinner')) return { errorClass: 'WRONG_WINNER', retryable: false, message };
  if (lower.includes('invalidfinalization') || lower.includes('invalid result')) return { errorClass: 'INVALID_RESULT', retryable: false, message };
  if (lower.includes('expired')) return { errorClass: 'POLICY_EXPIRED', retryable: false, message };
  if (lower.includes('replay') || lower.includes('already')) return { errorClass: 'REPLAYED', retryable: false, message };
  if (lower.includes('proof') && (lower.includes('malformed') || lower.includes('invalid'))) return { errorClass: 'MALFORMED_PROOF', retryable: false, message };
  if (lower.includes('receipt') && lower.includes('not successful')) return { errorClass: 'SOURCE_FAILED', retryable: false, message };
  if (lower.includes('prover') || lower.includes('attestation') || lower.includes('proof generation failed')) return { errorClass: 'PROVER_UNAVAILABLE', retryable: true, message };
  return { errorClass: 'UNKNOWN', retryable: true, message };
}

function transition(job: WorkerJob, state: JobState, outcome: WorkerJob['outcome'], errorClass: ErrorClass | null, message: string | null, patch: Partial<WorkerJob> = {}): WorkerJob {
  const at = new Date().toISOString();
  return { ...job, ...patch, state, productState: state, outcome, evidenceOutcome: outcome, lastErrorClass: errorClass, lastErrorMessage: message, updatedAt: at };
}

function isZeroAddress(value: string): boolean { return value.toLowerCase() === ZeroAddress.toLowerCase(); }

function isAddress(value: unknown): boolean { return /^0x[0-9a-fA-F]{40}$/.test(String(value ?? '')); }
function isBytes32(value: unknown): boolean { return /^0x[0-9a-fA-F]{64}$/.test(String(value ?? '')); }
function isZeroBytes32(value: unknown): boolean { return isBytes32(value) && /^0x0{64}$/i.test(String(value)); }

function unsignedInteger(value: unknown): bigint | null {
  const text = String(value ?? '');
  if (!/^\d+$/.test(text)) return null;
  try { return BigInt(text); } catch { return null; }
}

/** Accept only the receipt status values emitted by an EVM provider. */
function receiptStatus(value: unknown): 0 | 1 | null {
  if (value === 0) return 0;
  if (value === 1) return 1;
  return null;
}

/** Resolve the uncertain broadcast phase, with compatibility for old records. */
function submissionPhaseOf(job: Pick<WorkerJob, 'submissionPhase' | 'state' | 'settlementTransactionHash' | 'payoutTransactionHash'>): SubmissionPhase | undefined {
  if (job.submissionPhase === 'SETTLEMENT' || job.submissionPhase === 'PAYOUT') return job.submissionPhase;
  if (job.state === 'PAYOUT_PENDING' || job.payoutTransactionHash) return 'PAYOUT';
  if (job.state === 'SUBMITTING' || job.state === 'SETTLEMENT_PENDING' || job.settlementTransactionHash) return 'SETTLEMENT';
  return undefined;
}

function sourceResultError(result: { result: number; winner: string; playerOne: string; playerTwo: string; finalizationStatus: number; finalizedAt: string | number; deadline: string | number }): string | null {
  const status = Number(result.finalizationStatus);
  const value = Number(result.result);
  const winner = String(result.winner).toLowerCase();
  const playerOne = String(result.playerOne).toLowerCase();
  const playerTwo = String(result.playerTwo).toLowerCase();
  const finalizedAtValue = unsignedInteger(result.finalizedAt);
  const deadlineValue = unsignedInteger(result.deadline);
  if (finalizedAtValue === null || deadlineValue === null || finalizedAtValue <= 0n || deadlineValue <= 0n
    || finalizedAtValue > BigInt(Number.MAX_SAFE_INTEGER) || deadlineValue > BigInt(Number.MAX_SAFE_INTEGER)) return 'source finalization timestamps are invalid';
  const finalizedAt = Number(finalizedAtValue);
  const deadline = Number(deadlineValue);
  if (!isAddress(playerOne) || !isAddress(playerTwo) || isZeroAddress(playerOne) || isZeroAddress(playerTwo) || playerOne === playerTwo) return 'source player predicates are invalid';
  if (!isAddress(winner)) return 'source winner address is invalid';
  if (!Number.isSafeInteger(status) || !Number.isSafeInteger(value)) return 'source finalization result fields are invalid';
  if (![0, 1].includes(status)) return 'source finalization status is invalid';
  if (status === 0 && ![0, 1, 2].includes(value)) return 'normal finalization result is invalid';
  if (status === 1 && ![0, 3, 4].includes(value)) return 'timeout finalization result is invalid';
  if (value === 0 && winner !== ZeroAddress.toLowerCase()) return 'draw must have an empty winner';
  if (value === 1 && winner !== playerOne) return 'player-one result has the wrong winner';
  if (value === 2 && winner !== playerTwo) return 'player-two result has the wrong winner';
  if (value === 3 && winner !== playerOne) return 'timeout player-one result has the wrong winner';
  if (value === 4 && winner !== playerTwo) return 'timeout player-two result has the wrong winner';
  if (status === 1 && finalizedAt <= deadline) return 'timeout finalization must occur after the deadline';
  return null;
}

/** Validate immutable source predicates before consulting mutable policy state. */
function sourceJobError(job: WorkerJob, config: WorkerConfig): { errorClass: ErrorClass; message: string } | null {
  if (job.sourceChainId !== config.sourceChainId || job.sourceChainKey !== config.sourceChainKey) return { errorClass: 'WRONG_SOURCE_CHAIN', message: 'source result chain binding does not match the selected deployment' };
  if (String(job.sourceEventSignature) !== RPS_MATCH_FINALIZED_SIGNATURE) return { errorClass: 'WRONG_EVENT', message: 'source event signature is not the supported MatchFinalized event' };
  if (!isBytes32(job.sourceTransactionHash) || isZeroBytes32(job.sourceTransactionHash) || !isBytes32(job.tournamentId) || isZeroBytes32(job.tournamentId) || !isBytes32(job.matchId) || isZeroBytes32(job.matchId) || !isBytes32(job.rulesHash)) return { errorClass: 'INVALID_INPUT', message: 'source result identifiers are malformed' };
  if (!Number.isSafeInteger(job.sourceBlockNumber)
    || job.sourceBlockNumber < config.sourceDeploymentBlock
    || (job.sourceBlockHash !== null && (!isBytes32(job.sourceBlockHash) || isZeroBytes32(job.sourceBlockHash)))) {
    return { errorClass: 'INVALID_INPUT', message: 'source block identity is malformed or precedes the selected deployment' };
  }
  if (!isAddress(job.sourceRegistry)) return { errorClass: 'INVALID_INPUT', message: 'source registry address is malformed' };
  if (normalizeHex(job.sourceRegistry) !== normalizeHex(config.sourceRegistry)) return { errorClass: 'WRONG_SOURCE_REGISTRY', message: 'source result registry does not match the selected deployment' };
  if (!isAddress(job.playerOne) || !isAddress(job.playerTwo) || !isAddress(job.winner)) return { errorClass: 'INVALID_INPUT', message: 'source result participant addresses are malformed' };
  if (isZeroAddress(job.playerOne) || isZeroAddress(job.playerTwo) || normalizeHex(job.playerOne) === normalizeHex(job.playerTwo)) return { errorClass: 'INVALID_RESULT', message: 'source players must be distinct nonzero addresses' };
  if (job.sourceReceiptStatus !== 1) return { errorClass: 'SOURCE_FAILED', message: 'source receipt was not successful' };
  const nonce = unsignedInteger(job.resultNonce);
  if (nonce === null || nonce === 0n) return { errorClass: 'INVALID_NONCE', message: 'source result nonce is invalid' };
  let expectedNonce: bigint;
  try { expectedNonce = BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32'], [job.matchId]))); } catch { return { errorClass: 'INVALID_NONCE', message: 'source result nonce cannot be derived from match ID' }; }
  if (nonce !== expectedNonce) return { errorClass: 'INVALID_NONCE', message: 'source result nonce does not match match ID' };
  const resultError = sourceResultError({ ...job, finalizedAt: job.sourceFinalizedAt, deadline: job.sourceDeadline });
  if (resultError) return { errorClass: 'INVALID_RESULT', message: resultError };
  return null;
}

/** Validate fields returned by the destination policy getter. */
function policyFieldError(policy: Record<string, string | number>, job: WorkerJob, config: WorkerConfig): { errorClass: ErrorClass; message: string } | null {
  const state = Number(policy.state);
  if (!Number.isSafeInteger(state) || ![0, 1, 2, 3, 4].includes(state)) return { errorClass: 'INVALID_INPUT', message: 'policy state is outside the deployed enum' };
  const organizer = String(policy.organizer ?? '');
  // The all-zero getter result is the contract's absent-policy sentinel.  Do
  // not require the other tuple fields to be meaningful in this branch.
  if (state === 0 && isZeroAddress(organizer)) return null;
  if (!isAddress(organizer) || isZeroAddress(organizer)) return { errorClass: 'INVALID_INPUT', message: 'policy organizer address is malformed' };
  const sourceChainKey = Number(policy.sourceChainKey);
  if (!Number.isSafeInteger(sourceChainKey) || sourceChainKey < 0) return { errorClass: 'INVALID_INPUT', message: 'policy source chain key is malformed' };
  if (sourceChainKey !== config.sourceChainKey) return { errorClass: 'WRONG_SOURCE_CHAIN', message: 'policy source chain key does not match configured Attestcoin chain key' };
  if (!isAddress(policy.sourceRegistry)) return { errorClass: 'INVALID_INPUT', message: 'policy source registry address is malformed' };
  if (normalizeHex(String(policy.sourceRegistry)) !== normalizeHex(config.sourceRegistry)) return { errorClass: 'WRONG_SOURCE_REGISTRY', message: 'policy source registry is outside the selected deployment allowlist' };
  if (!isBytes32(policy.rulesHash)) return { errorClass: 'INVALID_INPUT', message: 'policy rules hash is malformed' };
  if (normalizeHex(String(policy.rulesHash)) !== normalizeHex(job.rulesHash)) return { errorClass: 'WRONG_RULES', message: 'policy rules hash does not match MatchFinalized' };
  if (!isAddress(policy.token)) return { errorClass: 'INVALID_INPUT', message: 'policy token address is malformed' };
  if (normalizeHex(String(policy.token)) !== normalizeHex(config.token)) return { errorClass: 'INVALID_INPUT', message: 'policy token does not match the selected deployment token' };
  const amount = unsignedInteger(policy.amount);
  if (amount === null || amount <= 0n) return { errorClass: 'INVALID_INPUT', message: 'policy amount must be a positive integer' };
  const settlementDeadline = unsignedInteger(policy.settlementDeadline);
  const refundDeadline = unsignedInteger(policy.refundDeadline);
  if (settlementDeadline === null || refundDeadline === null || settlementDeadline === 0n || refundDeadline <= settlementDeadline || settlementDeadline > BigInt(Number.MAX_SAFE_INTEGER) || refundDeadline > BigInt(Number.MAX_SAFE_INTEGER)) return { errorClass: 'INVALID_INPUT', message: 'policy deadlines are malformed' };
  if (state === 2 || state === 3) {
    if (!isAddress(policy.winner)) return { errorClass: 'INVALID_INPUT', message: 'settled policy winner address is malformed' };
    if (isZeroAddress(String(policy.winner)) || normalizeHex(String(policy.winner)) !== normalizeHex(job.winner)) return { errorClass: 'WRONG_WINNER', message: 'settled policy winner does not match MatchFinalized' };
    const nonce = unsignedInteger(policy.resultNonce);
    const jobNonce = unsignedInteger(job.resultNonce);
    if (nonce === null || nonce === 0n || jobNonce === null || nonce !== jobNonce) return { errorClass: 'INVALID_NONCE', message: 'settled policy result nonce does not match MatchFinalized' };
    if (!isBytes32(policy.sourceQueryKey) || isZeroBytes32(policy.sourceQueryKey)) return { errorClass: 'INVALID_INPUT', message: 'settled policy source query key is invalid' };
  }
  return null;
}

function validProofShape(proof: ProofData): boolean {
  return Number.isSafeInteger(Number(proof.chainKey))
    && Number.isSafeInteger(Number(proof.headerNumber))
    && Number(proof.headerNumber) >= 0
    // A source transaction is never an empty byte string.  Requiring complete
    // byte pairs also prevents odd-length hex from reaching the ABI encoder.
    && /^0x(?:[0-9a-fA-F]{2})+$/.test(String(proof.txBytes))
    && /^0x[0-9a-fA-F]{64}$/.test(String(proof.txHash))
    && /^0x[0-9a-fA-F]{64}$/.test(String(proof.merkleProof?.root))
    && /^0x[0-9a-fA-F]{64}$/.test(String(proof.continuityProof?.lowerEndpointDigest))
    && Array.isArray(proof.merkleProof?.siblings)
    && Array.isArray(proof.continuityProof?.roots)
    && proof.merkleProof.siblings.every((entry) => /^0x[0-9a-fA-F]{64}$/.test(String(entry.hash)) && typeof entry.isLeft === 'boolean')
    && proof.continuityProof.roots.every((root) => /^0x[0-9a-fA-F]{64}$/.test(String(root)));
}

export function isProofResumableState(state: JobState): boolean {
  return ['MINED', 'AWAITING_ATTESTATION', 'PROOF_READY', 'PROOF_PREFLIGHT_PASS'].includes(state);
}

function retryAt(delayMs = 30_000): string {
  return new Date(Date.now() + delayMs).toISOString();
}

export class WorkerRuntime {
  readonly config: WorkerConfig;
  readonly store: DurableStore;
  readonly sourceProvider: JsonRpcProvider;
  readonly destinationProvider: JsonRpcProvider;
  readonly sourceRegistry: Contract;
  readonly vault: Contract;
  readonly asc: Contract;
  readonly workerAddress: string | null;
  private workerSigner: Wallet | null;
  private running = false;
  private readonly runtimeId = `${process.pid}:${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private loopInFlight = false;
  private loopIdle: Promise<void> = Promise.resolve();
  private stopping = false;
  private lastLoopAt: string | null = null;
  private configuration: ConfigurationCheck = { outcome: 'UNKNOWN' };
  private chainInfoCheck: ConfigurationCheck = { outcome: 'UNKNOWN' };
  private sourceDiscoveryCheck: ConfigurationCheck = { outcome: 'UNKNOWN', message: 'source discovery has not run' };
  private activeLeaseOwner: string | null = null;
  private leaseLost = false;

  private constructor(config: WorkerConfig, store: DurableStore) {
    this.config = config;
    this.store = store;
    this.sourceProvider = new JsonRpcProvider(config.sourceRpc);
    this.destinationProvider = new JsonRpcProvider(config.destinationRpc);
    this.workerSigner = config.workerPrivateKey ? new Wallet(config.workerPrivateKey, this.destinationProvider) : null;
    this.workerAddress = this.workerSigner?.address.toLowerCase() ?? null;
    this.sourceRegistry = new Contract(config.sourceRegistry, REGISTRY_ABI, this.sourceProvider);
    this.vault = new Contract(config.vault, VAULT_ABI, this.workerSigner ?? this.destinationProvider);
    this.asc = new Contract(config.asc, ASC_ABI, this.workerSigner ?? this.destinationProvider);
  }

  static async create(config = loadWorkerConfig()): Promise<WorkerRuntime> {
    const store = await DurableStore.open(config.dataDirectory, config.sourceStartBlock);
    return new WorkerRuntime(config, store);
  }

  async validateConfiguration(): Promise<ConfigurationCheck> {
    try {
      const [sourceNetwork, destinationNetwork] = await Promise.all([this.sourceProvider.getNetwork(), this.destinationProvider.getNetwork()]);
      if (Number(sourceNetwork.chainId) !== this.config.sourceChainId) throw new Error('source RPC network does not match Sepolia');
      if (Number(destinationNetwork.chainId) !== this.config.destinationChainId) throw new Error('destination RPC network does not match CC3');
      const [finalizer, settlementAuthority, ascVault, ascKey, verifier] = await Promise.all([
        this.sourceRegistry.finalizer(),
        this.vault.settlementAuthority(),
        this.asc.vault(),
        this.asc.expectedSourceChainKey(),
        this.asc.VERIFIER(),
      ]);
      const [registryCode, tokenCode, vaultCode, ascCode, sourceChainId, expectedSourceChainId, action, eventSignature] = await Promise.all([
        this.sourceProvider.getCode(this.config.sourceRegistry),
        this.destinationProvider.getCode(this.config.token),
        this.destinationProvider.getCode(this.config.vault),
        this.destinationProvider.getCode(this.config.asc),
        this.sourceRegistry.sourceChainId(),
        this.asc.EXPECTED_SOURCE_CHAIN_ID(),
        this.asc.ACTION_MATCH_FINALIZED(),
        this.asc.MATCH_FINALIZED_SIGNATURE(),
      ]);
      if ([registryCode, tokenCode, vaultCode, ascCode].some((code) => code === '0x')) throw new Error('one or more selected deployment addresses has no contract bytecode');
      assertAddress('source finalizer', finalizer, this.config.sourceFinalizer);
      const settlementWorker = this.config.manifest.destination.settlementWorker ?? this.config.manifest.destination.deployer;
      assertAddress('vault settlement authority', settlementAuthority, this.config.asc);
      if (this.workerAddress) assertAddress('worker signer', this.workerAddress, settlementWorker);
      assertAddress('ASC vault', ascVault, this.config.vault);
      if (Number(sourceChainId) !== this.config.sourceChainId || Number(expectedSourceChainId) !== this.config.sourceChainId) throw new Error('source chain binding mismatch');
      if (Number(ascKey) !== this.config.sourceChainKey) throw new Error('ASC expected source chain key mismatch');
      if (Number(action) !== 0 || String(eventSignature).toLowerCase() !== id(RPS_MATCH_FINALIZED_SIGNATURE).toLowerCase()) throw new Error('ASC source event/action binding mismatch');
      assertAddress('ASC Block Prover', verifier, this.config.expectedBlockProver);
      const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(this.destinationProvider as any, this.config.expectedChainInfo);
      const supported = await chainInfoProvider.getSupportedChains();
      const source = (supported as any[]).find((entry) => Number(entry.chainKey) === this.config.sourceChainKey);
      if (!source || Number(source.chainId) !== this.config.sourceChainId) throw new Error('ChainInfo does not map configured chain key to Sepolia');
      this.chainInfoCheck = { outcome: 'PASS' };
      this.configuration = { outcome: 'PASS' };
      if (!this.workerSigner) this.configuration = { outcome: 'UNKNOWN', message: 'Worker signer is absent; read-only API is available but settlement submission is disabled.' };
      logEvent('configuration_validated', { outcome: this.configuration.outcome, sourceRegistry: this.config.sourceRegistry, vault: this.config.vault, asc: this.config.asc });
      return this.configuration;
    } catch (error) {
      const classified = classifyError(error);
      const transient = classified.errorClass === 'RPC_UNAVAILABLE' || classified.errorClass === 'PROVER_UNAVAILABLE';
      const outcome = transient ? 'UNKNOWN' : 'FAIL';
      this.configuration = { outcome, message: classified.message };
      this.chainInfoCheck = { outcome, message: classified.message };
      logEvent('configuration_failed', { outcome, error: classified.message });
      return this.configuration;
    }
  }

  getConfigurationCheck(): ConfigurationCheck { return { ...this.configuration }; }

  private sourceExplorer(hash: string): string { return `${this.config.sourceExplorer}/tx/${hash}`; }
  private destinationExplorer(hash: string): string { return `${this.config.destinationExplorer}/tx/${hash}`; }

  private async save(job: WorkerJob, reason: string, patch: Partial<WorkerJob> = {}): Promise<WorkerJob> {
    if (this.activeLeaseOwner && this.leaseLost) throw new Error(`LEASE_LOST for ${job.jobId}`);
    const previousState = job.state;
    // Lease renewals run concurrently with long RPC/prover calls.  The local
    // job snapshot can therefore contain an older expiry; never write that
    // stale lease back over the durable renewal.  An ownership change is a
    // hard loss and must fail closed before appending any job record.
    const durableLease = this.activeLeaseOwner ? this.store.getJob(job.jobId)?.lease : undefined;
    if (this.activeLeaseOwner && durableLease?.owner !== this.activeLeaseOwner) throw new Error(`LEASE_LOST for ${job.jobId}`);
    const updated = {
      ...job,
      ...patch,
      ...(this.activeLeaseOwner ? { lease: durableLease } : {}),
      updatedAt: new Date().toISOString(),
    };
    await this.store.saveJob(updated, reason, this.activeLeaseOwner ?? undefined);
    logEvent('job_state', { jobId: updated.jobId, tournamentId: updated.tournamentId, sourceTransactionHash: updated.sourceTransactionHash, from: previousState, to: updated.state, attempt: updated.attemptCount, reason });
    return updated;
  }

  private assertLease(): void {
    if (this.activeLeaseOwner && this.leaseLost) throw new Error('LEASE_LOST: worker lease renewal failed');
  }

  private async failOrRetry(job: WorkerJob, error: unknown, reason: string): Promise<WorkerJob> {
    const classified = classifyError(error);
    const possibleHash = normalizeHex(String((error as any)?.transactionHash ?? (error as any)?.hash ?? ''));
    if (possibleHash.match(/^0x[0-9a-f]{64}$/) && (reason.includes('settlement') || reason.includes('payout'))) {
      const settlement = reason.includes('settlement');
      return this.save(job, `${reason}: transaction hash recovered`, transition(job, settlement ? 'SETTLEMENT_PENDING' : 'PAYOUT_PENDING', 'UNKNOWN', 'RPC_UNAVAILABLE', 'submission outcome is uncertain; the recovered transaction hash will be reconciled before retry', settlement ? { settlementTransactionHash: possibleHash, submissionUncertainty: false, submissionPhase: 'SETTLEMENT', explorerLinks: { ...job.explorerLinks, settlement: this.destinationExplorer(possibleHash) }, nextRetryAt: retryAt() } : { payoutTransactionHash: possibleHash, submissionUncertainty: false, submissionPhase: 'PAYOUT', explorerLinks: { ...job.explorerLinks, payout: this.destinationExplorer(possibleHash) }, nextRetryAt: retryAt() }));
    }
    if (classified.retryable && !possibleHash.match(/^0x[0-9a-f]{64}$/) && (reason.includes('submission failed') || reason.includes('submission uncertainty'))) {
      const payout = reason.includes('payout');
      return this.save(job, `${reason}: unresolved`, transition(job, payout ? 'PAYOUT_PENDING' : 'SETTLEMENT_PENDING', 'UNKNOWN', classified.errorClass, 'transaction submission outcome is unknown; public policy/events will be reconciled before any retry', { submissionUncertainty: true, submissionPhase: payout ? 'PAYOUT' : 'SETTLEMENT', nextRetryAt: retryAt() }));
    }
    const attempts = job.attemptCount + 1;
    const retryCount = job.retryCount + 1;
    if (!classified.retryable || retryCount > this.config.maxAttempts) {
      const state: JobState = classified.errorClass === 'REPLAYED' ? 'REPLAY_REJECTED' : 'VERIFICATION_FAILED';
      return this.save(job, reason, transition(job, state, 'FAIL', classified.errorClass, classified.message, {
        attemptCount: attempts,
        retryCount,
        nextRetryAt: null,
        // A terminal semantic/replay result is authoritative. Do not leave a
        // stale broadcast marker that could route future reconciliation into
        // an already-resolved submission phase.
        submissionUncertainty: false,
        submissionPhase: undefined,
      }));
    }
    const delay = Math.min(15 * 1000 * (2 ** Math.min(retryCount - 1, 8)), 15 * 60 * 1000);
    const nextRetryAt = new Date(Date.now() + delay).toISOString();
    return this.save(job, `${reason}: retry scheduled`, transition(job, 'INFRASTRUCTURE_UNAVAILABLE', 'UNKNOWN', classified.errorClass, classified.message, { attemptCount: attempts, retryCount, nextRetryAt }));
  }

  private newJob(sourceTxHash: string, sourceBlockNumber: number, blockHash: string | null, sourceGas: string | null, sourceTimestamp: string | null, result: ReturnType<typeof rpsMatchFinalizedAdapter.decode>, receiptStatus: number | null): WorkerJob {
    const sourceHash = normalizeHex(sourceTxHash);
    const fields = resultToJobFields(result);
    const jobId = this.store.newJobId(this.config.sourceChainId, sourceHash);
    const at = new Date().toISOString();
    return {
      schemaVersion: 1,
      jobId,
      sourceChainId: this.config.sourceChainId,
      sourceChainKey: this.config.sourceChainKey,
      sourceTransactionHash: sourceHash,
      sourceBlockNumber,
      sourceBlockHash: blockHash,
      sourceGas,
      sourceTimestamp,
      sourceRegistry: this.config.sourceRegistry,
      sourceEventSignature: RPS_MATCH_FINALIZED_SIGNATURE,
      ...fields,
      sourceReceiptStatus: receiptStatus,
      state: 'MINED',
      productState: 'MINED',
      dataMode: 'LIVE',
      outcome: 'PASS',
      evidenceOutcome: 'PASS',
      attemptCount: 0,
      retryCount: 0,
      nextRetryAt: null,
      lease: null,
      createdAt: at,
      updatedAt: at,
      proofStatus: 'NOT_REQUESTED',
      proofHeader: null,
      proofDigest: null,
      proofCached: null,
      proofLatencyMs: null,
      proofPreflightOutcome: 'UNKNOWN',
      settlementTransactionHash: null,
      settlementReceiptStatus: null,
      settlementBlock: null,
      settlementGas: null,
      settlementTimestamp: null,
      payoutTransactionHash: null,
      submissionUncertainty: false,
      submissionPhase: undefined,
      payoutReceiptStatus: null,
      payoutBlock: null,
      payoutGas: null,
      payoutTimestamp: null,
      replayEvidence: null,
      refundRecoveryEvidence: null,
      policyState: null,
      policy: null,
      resultVerified: null,
      tournamentSettled: null,
      prizeClaimed: null,
      explorerLinks: { source: this.sourceExplorer(sourceHash), settlement: null, payout: null, replay: null, recovery: null },
      lastErrorClass: null,
      lastErrorMessage: null,
      evidenceReferences: [],
    };
  }

  private async readPolicy(job: WorkerJob): Promise<Record<string, string | number>> {
    return asPolicy(await this.vault.policies(job.tournamentId));
  }

  async admit(job: WorkerJob): Promise<AdmissionResult> {
    // Source predicates are immutable and locally available. Validate them
    // before touching mutable destination policy state so malformed journal
    // records cannot be hidden behind an RPC outage or influence admission.
    const sourceError = sourceJobError(job, this.config);
    if (sourceError) return { kind: 'PERMANENT_FAILURE', ...sourceError };
    // Draws and empty winners are deterministic source outcomes that the
    // deployed payout path cannot settle. Resolve them before touching the
    // mutable destination policy/RPC boundary.
    if (job.result === 0 || isZeroAddress(job.winner)) return { kind: 'NON_PAYABLE_RESULT', message: 'draw or empty winner is not payable by the deployed settlement flow' };
    let policy: Record<string, string | number>;
    try { policy = await this.readPolicy(job); } catch (error) {
      const classified = classifyError(error);
      return { kind: 'INFRASTRUCTURE_UNAVAILABLE', errorClass: classified.errorClass, message: classified.message };
    }
    const state = Number(policy.state);
    if (!Number.isInteger(state) || ![0, 1, 2, 3, 4].includes(state)) return { kind: 'PERMANENT_FAILURE', errorClass: 'INVALID_INPUT', message: 'policy state is outside the deployed enum' };
    if (isZeroAddress(String(policy.organizer)) && state === 0) return { kind: 'WAITING_FOR_POLICY', errorClass: 'POLICY_NOT_FOUND', message: 'matching CC3 policy has not been created yet' };
    const policyError = policyFieldError(policy, job, this.config);
    if (policyError) return { kind: 'PERMANENT_FAILURE', ...policyError };
    if (state === 0) return { kind: 'WAITING_FOR_POLICY', errorClass: 'POLICY_NOT_FUNDED', message: 'policy exists but is not funded' };
    if (state === 4) return { kind: 'REFUNDED', policyState: 4, policy };
    // A policy that is already settled must still be bound to this exact
    // source result before it is treated as an idempotent success.  Otherwise
    // a stale/malformed journal record could inherit another result's payout.
    if (state === 2 || state === 3) return { kind: 'ALREADY_SETTLED', policyState: state, policy };
    const latest = await this.destinationProvider.getBlock('latest');
    if (!latest) return { kind: 'INFRASTRUCTURE_UNAVAILABLE', errorClass: 'RPC_UNAVAILABLE', message: 'destination latest block unavailable' };
    const latestTimestamp = unsignedInteger(latest.timestamp);
    if (latestTimestamp === null || latestTimestamp > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { kind: 'INFRASTRUCTURE_UNAVAILABLE', errorClass: 'RPC_UNAVAILABLE', message: 'destination latest block timestamp is malformed' };
    }
    const settlementDeadline = unsignedInteger(policy.settlementDeadline);
    if (settlementDeadline !== null && settlementDeadline < latestTimestamp) return { kind: 'PERMANENT_FAILURE', errorClass: 'POLICY_EXPIRED', message: 'settlement deadline has passed' };
    const businessKey = keccak256(AbiCoder.defaultAbiCoder().encode(['uint64', 'address', 'bytes32', 'uint256'], [this.config.sourceChainKey, this.config.sourceRegistry, job.tournamentId, job.resultNonce]));
    if (await this.asc.usedBusinessResults(businessKey)) return { kind: 'PERMANENT_FAILURE', errorClass: 'REPLAYED', message: 'business result replay mapping is already consumed' };
    return { kind: 'ACCEPTED', policy };
  }

  private async discoverRange(): Promise<void> {
    const latest = await this.sourceProvider.getBlockNumber();
    const safeHead = latest - this.config.confirmations;
    const cursor = this.store.getCursor();
    if (safeHead < cursor.nextBlock) return;
    const fromBlock = Math.max(this.config.sourceStartBlock, cursor.nextBlock - this.config.reorgRewind);
    // Rewind affects the lower bound only.  The upper bound is anchored to
    // the durable cursor so a rewind larger than the batch cannot stall it.
    const toBlock = Math.min(safeHead, cursor.nextBlock + this.config.batchSize - 1);
    if (toBlock < fromBlock) return;
    const logs = await this.sourceProvider.getLogs({ address: this.config.sourceRegistry, topics: [id(RPS_MATCH_FINALIZED_SIGNATURE)], fromBlock, toBlock });
    const txHashes = [...new Set(logs.map((log) => normalizeHex(log.transactionHash)))];
    for (const txHash of txHashes) {
      if (this.store.getJobBySource(this.config.sourceChainId, txHash)) continue;
      const receipt = await this.sourceProvider.getTransactionReceipt(txHash);
      if (!receipt || receipt.status !== 1 || receipt.blockNumber === null) throw new Error(`source receipt unavailable or unsuccessful for ${txHash}`);
      const result = rpsMatchFinalizedAdapter.decode(receipt, this.config.sourceRegistry);
      if (Number(result.sourceChainId) !== this.config.sourceChainId) throw new Error(`source event chain ID mismatch for ${txHash}`);
      const expectedNonce = BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32'], [result.matchId]))).toString();
      if (expectedNonce !== String(result.resultNonce)) throw new Error(`source result nonce mismatch for ${txHash}`);
      const resultError = sourceResultError(result);
      if (resultError) throw new Error(`${resultError} for ${txHash}`);
      const sourceBlock = await this.sourceProvider.getBlock(receipt.blockNumber);
      const observation = {
        sourceChainId: this.config.sourceChainId,
        sourceChainKey: this.config.sourceChainKey,
        transactionHash: txHash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        registry: this.config.sourceRegistry,
        eventSignature: RPS_MATCH_FINALIZED_SIGNATURE,
        receiptStatus: receipt.status,
        observedAt: new Date().toISOString(),
      } as const;
      await this.store.recordObservation(observation);
      let job = this.newJob(txHash, receipt.blockNumber, receipt.blockHash, receipt.gasUsed?.toString() ?? null, sourceBlock ? new Date(Number(sourceBlock.timestamp) * 1000).toISOString() : null, result, receipt.status);
      if (this.store.getJobByBusiness(job.tournamentId, job.resultNonce)) continue;
      const created = await this.store.createJob(job, 'source MatchFinalized discovered');
      if (!created.created) continue;
      logEvent('source_event_discovered', { jobId: job.jobId, tournamentId: job.tournamentId, sourceTransactionHash: job.sourceTransactionHash, sourceBlock: job.sourceBlockNumber });
      // Admission is a chain read and can race another worker's processing of
      // the newly-created job. Fence the eventual journal write with a short
      // discovery lease so a stale snapshot cannot clobber proof/settlement
      // progress made concurrently.
      const discoveryOwner = `${this.runtimeId}:discovery`;
      const admittedJob = await this.store.claimLease(job.jobId, discoveryOwner, this.config.leaseTtlMs);
      if (!admittedJob) continue;
      const discoveryRenewer = setInterval(() => { void this.store.renewLease(job.jobId, discoveryOwner, this.config.leaseTtlMs); }, Math.max(1_000, Math.floor(this.config.leaseTtlMs / 2)));
      try {
        job = admittedJob;
        const admission = await this.admit(job);
        if (admission.kind === 'WAITING_FOR_POLICY') job = transition(job, 'WAITING_FOR_POLICY', 'UNKNOWN', admission.errorClass, admission.message, { nextRetryAt: retryAt() });
        else if (admission.kind === 'NON_PAYABLE_RESULT') job = transition(job, 'NON_PAYABLE_RESULT', 'FAIL', null, admission.message, { nextRetryAt: null });
        else if (admission.kind === 'PERMANENT_FAILURE') job = transition(job, 'VERIFICATION_FAILED', 'FAIL', admission.errorClass, admission.message, { nextRetryAt: null });
        else if (admission.kind === 'ALREADY_SETTLED') job = transition(job, 'SETTLEMENT_COMPLETE', 'PASS', 'ALREADY_SETTLED', 'policy already contains settlement state; payout evidence will be reconciled separately', { policyState: admission.policyState, policy: admission.policy, productState: 'CLAIMABLE', nextRetryAt: null });
        else if (admission.kind === 'REFUNDED') job = transition(job, 'REFUNDED', 'PASS', 'POLICY_REFUNDED', 'policy was refunded before this result could settle', { policyState: admission.policyState, policy: admission.policy, nextRetryAt: null });
        else if (admission.kind === 'INFRASTRUCTURE_UNAVAILABLE') job = transition(job, 'INFRASTRUCTURE_UNAVAILABLE', 'UNKNOWN', admission.errorClass, admission.message, { nextRetryAt: retryAt() });
        else job = { ...job, policy: admission.policy, policyState: Number(admission.policy.state), nextRetryAt: null, updatedAt: new Date().toISOString() };
        await this.store.saveJob(job, 'source admission', discoveryOwner);
      } finally {
        clearInterval(discoveryRenewer);
        await this.store.releaseLease(job.jobId, discoveryOwner).catch((error) => logEvent('discovery_lease_release_failed', { jobId: job.jobId, error: safeError(error) }));
      }
    }
    await this.store.setCursor({ schemaVersion: 1, nextBlock: toBlock + 1, lastScannedBlock: toBlock, updatedAt: new Date().toISOString() });
    this.sourceDiscoveryCheck = { outcome: 'PASS' };
    logEvent('cursor_advanced', { fromBlock, toBlock, nextBlock: toBlock + 1, events: txHashes.length });
  }

  private async waitForReceipt(provider: JsonRpcProvider, hash: string): Promise<any | null> {
    try {
      return await provider.waitForTransaction(hash, this.config.confirmations || 1, this.config.pollIntervalMs * 2);
    } catch (error) {
      // ethers rejects on its polling timeout.  The transaction hash is
      // already durable, so convert that timeout into a pending result and let
      // the normal reconciliation path inspect it before any retry.
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (message.includes('timeout') || message.includes('timed out')) return null;
      throw error;
    }
  }

  private parsedReceiptEvent(receipt: any, iface: Interface, name: string, expectedAddress: string): any | null {
    for (const log of receipt?.logs ?? []) {
      if (String(log.address ?? '').toLowerCase() !== expectedAddress.toLowerCase()) continue;
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === name) return parsed;
      } catch { /* unrelated log */ }
    }
    return null;
  }

  private eventValue(parsed: any, name: string, index: number): string {
    return String(parsed?.args?.[name] ?? parsed?.args?.[index] ?? '');
  }

  private receiptMatchesTarget(receipt: any, expectedHash: string | null, expectedTo: string): boolean {
    if (!receipt?.to || normalizeHex(String(receipt.to)) !== normalizeHex(expectedTo)) return false;
    if (expectedHash && (!receipt?.hash || normalizeHex(String(receipt.hash)) !== normalizeHex(expectedHash))) return false;
    return true;
  }

  private expectedBusinessKey(job: WorkerJob): string {
    return keccak256(AbiCoder.defaultAbiCoder().encode(['uint64', 'address', 'bytes32', 'uint256'], [job.sourceChainKey, this.config.sourceRegistry, job.tournamentId, job.resultNonce]));
  }

  /**
   * Policy fields are read from an untrusted RPC boundary.  A payout or
   * reconciliation record is usable only when every source/business predicate
   * and the selected token still bind to this durable job.
   */
  private policyMatchesJob(policy: Record<string, string | number>, job: WorkerJob): boolean {
    let policyNonce: string;
    let jobNonce: string;
    let amount: bigint;
    try {
      policyNonce = BigInt(String(policy.resultNonce ?? '')).toString();
      jobNonce = BigInt(String(job.resultNonce)).toString();
      amount = BigInt(String(policy.amount ?? '0'));
    } catch {
      return false;
    }
    return Number.isSafeInteger(Number(policy.sourceChainKey))
      && Number(policy.sourceChainKey) === job.sourceChainKey
      && normalizeHex(String(policy.sourceRegistry ?? '')) === normalizeHex(job.sourceRegistry)
      && normalizeHex(String(policy.rulesHash ?? '')) === normalizeHex(job.rulesHash)
      && normalizeHex(String(policy.token ?? '')) === normalizeHex(this.config.token)
      && policyNonce === jobNonce
      && normalizeHex(String(policy.winner ?? '')) === normalizeHex(job.winner)
      && amount > 0n;
  }

  private hasBoundSettlementEvidence(job: WorkerJob): boolean {
    return Boolean(job.settlementTransactionHash)
      && job.settlementReceiptStatus === 1
      && job.resultVerified === true
      && job.tournamentSettled === true;
  }

  private settlementEvidence(receipt: any, job: WorkerJob, policy: Record<string, string | number>, expectedQueryKey?: string): { resultVerified: boolean; tournamentSettled: boolean } {
    if (receiptStatus(receipt?.status) !== 1 || !this.receiptMatchesTarget(receipt, job.settlementTransactionHash, this.config.asc)) return { resultVerified: false, tournamentSettled: false };
    if (!this.policyMatchesJob(policy, job)) return { resultVerified: false, tournamentSettled: false };
    const ascEvent = this.parsedReceiptEvent(receipt, new Interface(ASC_ABI), 'ResultVerified', this.config.asc);
    const vaultEvent = this.parsedReceiptEvent(receipt, new Interface(VAULT_ABI), 'TournamentSettled', this.config.vault);
    if (!ascEvent || !vaultEvent) return { resultVerified: false, tournamentSettled: false };
    const sourceQueryKey = this.eventValue(ascEvent, 'sourceQueryKey', 2).toLowerCase();
    const expectedSourceQuery = (expectedQueryKey ?? String(policy.sourceQueryKey ?? '')).toLowerCase();
    const policySourceQuery = String(policy.sourceQueryKey ?? '').toLowerCase();
    const policyQueryBound = Number(policy.state) < 2
      || (/^0x[0-9a-f]{64}$/.test(policySourceQuery) && !/^0x0+$/.test(policySourceQuery) && policySourceQuery === sourceQueryKey);
    const resultVerified = this.eventValue(ascEvent, 'tournamentId', 0).toLowerCase() === job.tournamentId
      && this.eventValue(ascEvent, 'businessKey', 1).toLowerCase() === this.expectedBusinessKey(job).toLowerCase()
      && sourceQueryKey !== ''
      && !/^0x0+$/.test(sourceQueryKey)
      && policyQueryBound
      && (!expectedSourceQuery || expectedSourceQuery === '0x' || /^0x0+$/.test(expectedSourceQuery) || sourceQueryKey === expectedSourceQuery)
      && this.eventValue(ascEvent, 'winner', 3).toLowerCase() === job.winner.toLowerCase()
      && this.eventValue(ascEvent, 'resultNonce', 4) === String(job.resultNonce);
    const tournamentSettled = this.eventValue(vaultEvent, 'tournamentId', 0).toLowerCase() === job.tournamentId
      && this.eventValue(vaultEvent, 'winner', 1).toLowerCase() === job.winner.toLowerCase()
      && this.eventValue(vaultEvent, 'resultNonce', 2) === String(job.resultNonce)
      && this.eventValue(vaultEvent, 'sourceQueryKey', 3).toLowerCase() === sourceQueryKey;
    return { resultVerified, tournamentSettled };
  }

  private payoutEvidence(receipt: any, job: WorkerJob, policy: Record<string, string | number>): boolean {
    if (receiptStatus(receipt?.status) !== 1 || !this.receiptMatchesTarget(receipt, job.payoutTransactionHash, this.config.vault)) return false;
    if (!this.policyMatchesJob(policy, job)) return false;
    const event = this.parsedReceiptEvent(receipt, new Interface(VAULT_ABI), 'PrizeClaimed', this.config.vault);
    return Boolean(event)
      && this.eventValue(event, 'tournamentId', 0).toLowerCase() === job.tournamentId
      && this.eventValue(event, 'winner', 1).toLowerCase() === String(policy.winner ?? job.winner).toLowerCase()
      && this.eventValue(event, 'amount', 2) === String(policy.amount ?? '');
  }

  private async reconcileExistingState(job: WorkerJob): Promise<WorkerJob> {
    // Validate immutable source predicates before any destination read. This
    // keeps malformed journal state terminal and independent of RPC health.
    const sourceError = sourceJobError(job, this.config);
    if (sourceError) return this.save(job, 'existing source predicates invalid', transition(job, 'VERIFICATION_FAILED', 'FAIL', sourceError.errorClass, sourceError.message, { submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null }));
    try {
      const latestBlock = await this.destinationProvider.getBlockNumber();
      const from = Math.max(this.config.destinationDeploymentBlock, latestBlock - 100_000);
      const latest = latestBlock;
      const policy = await this.readPolicy(job);
      const policyState = Number(policy.state);
      const policyAbsent = isZeroAddress(String(policy.organizer)) && policyState === 0;
      const phase = submissionPhaseOf(job);
      if (!Number.isInteger(policyState) || ![0, 1, 2, 3, 4].includes(policyState)) {
        return this.save(job, 'existing policy state malformed', transition(job, 'UNKNOWN', 'UNKNOWN', 'INVALID_INPUT', 'destination policy state is outside the deployed enum', { policy, policyState: Number.isFinite(policyState) ? policyState : null, submissionPhase: phase, nextRetryAt: retryAt() }));
      }
      if (!policyAbsent) {
        const policyError = policyFieldError(policy, job, this.config);
        if (policyError) return this.save(job, 'existing policy predicates invalid', transition(job, 'VERIFICATION_FAILED', 'FAIL', policyError.errorClass, policyError.message, { policy, policyState, submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null }));
      }
      let updated = job;
      let settlementValidated = false;
      let payoutValidated = false;
      const unvalidatedEvidence = (): Partial<WorkerJob> => ({
        ...(settlementValidated ? {} : { settlementReceiptStatus: null, settlementBlock: null, settlementGas: null, settlementTimestamp: null, resultVerified: null, tournamentSettled: null }),
        ...(payoutValidated ? {} : { payoutReceiptStatus: null, payoutBlock: null, payoutGas: null, payoutTimestamp: null, prizeClaimed: null }),
      });
      if (policyState === 0) {
        const errorClass = policyAbsent ? 'POLICY_NOT_FOUND' : 'POLICY_NOT_FUNDED';
        return this.save(job, 'policy is absent or unfunded during reconciliation', transition(job, 'WAITING_FOR_POLICY', 'UNKNOWN', errorClass, policyAbsent ? 'matching CC3 policy is not present on the destination chain' : 'matching CC3 policy is not funded', {
          policy,
          policyState: 0,
          settlementReceiptStatus: null,
          settlementBlock: null,
          settlementGas: null,
          settlementTimestamp: null,
          resultVerified: null,
          tournamentSettled: null,
          payoutReceiptStatus: null,
          payoutBlock: null,
          payoutGas: null,
          payoutTimestamp: null,
          prizeClaimed: null,
          submissionPhase: phase,
          nextRetryAt: retryAt(),
        }));
      }
      // State 4 is an authoritative terminal policy state. It does not need
      // event-log discovery, so an RPC log-range outage cannot hide a refund.
      if (policyState === 4) {
        return this.save(job, 'policy refunded during reconciliation', transition(job, 'REFUNDED', 'PASS', 'POLICY_REFUNDED', 'destination policy is refunded; no payout will be attempted', { ...unvalidatedEvidence(), policy, policyState: 4, submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null }));
      }
      // A funded policy with no transaction identity has no receipt to
      // reconcile. Reset stale journal projections without depending on the
      // destination event index; retain proof-in-flight phases for resumption.
      if (policyState === 1 && !job.settlementTransactionHash && !job.payoutTransactionHash) {
        const inFlight = ['AWAITING_ATTESTATION', 'PROOF_READY', 'PROOF_PREFLIGHT_PASS'].includes(job.state);
        if (inFlight) return this.save(job, 'funded policy awaiting proof', { ...unvalidatedEvidence(), policy, policyState: 1, submissionPhase: phase });
        return this.save(job, 'funded policy resets stale projection', transition(job, 'MINED', 'PASS', null, null, { ...unvalidatedEvidence(), policy, policyState: 1, submissionPhase: phase, productState: 'MINED', nextRetryAt: null }));
      }
      const [settledLogs, claimLogs] = await Promise.all([
        (this.asc as any).queryFilter((this.asc as any).filters.ResultVerified(job.tournamentId), from, latest),
        (this.vault as any).queryFilter((this.vault as any).filters.PrizeClaimed(job.tournamentId), from, latest),
      ]);
      const applySettlementReceipt = async (receipt: any, fallbackHash?: string): Promise<boolean> => {
        const candidateHash = normalizeHex(String(receipt?.hash ?? fallbackHash ?? ''));
        // A transaction identity is immutable once journaled.  A valid event
        // from a different hash is useful diagnostic evidence, but cannot be
        // promoted into this job or overwrite the assigned identity.
        if (updated.settlementTransactionHash && candidateHash !== normalizeHex(updated.settlementTransactionHash)) return false;
        if (receipt?.hash && fallbackHash && normalizeHex(String(receipt.hash)) !== normalizeHex(String(fallbackHash))) return false;
        const evidence = this.settlementEvidence(receipt, updated, policy, String(policy.sourceQueryKey ?? ''));
        if (!evidence.resultVerified || !evidence.tournamentSettled) return false;
        const hash = candidateHash;
        if (!/^0x[0-9a-f]{64}$/.test(hash)) return false;
        const block = await this.destinationProvider.getBlock(receipt.blockNumber).catch(() => null);
        updated = { ...updated, settlementTransactionHash: hash, settlementReceiptStatus: 1, settlementBlock: receipt.blockNumber, settlementGas: receipt.gasUsed?.toString() ?? null, settlementTimestamp: block ? new Date(Number(block.timestamp) * 1000).toISOString() : null, resultVerified: true, tournamentSettled: true, explorerLinks: { ...updated.explorerLinks, settlement: this.destinationExplorer(hash) } };
        settlementValidated = true;
        return true;
      };
      for (const candidate of [...settledLogs].reverse()) {
        const receipt = await candidate.getTransactionReceipt();
        if (await applySettlementReceipt(receipt, candidate.transactionHash)) break;
      }
      // A bounded event-log query may not include an old settlement.  Never
      // trust persisted receipt flags in that case; validate the persisted
      // transaction identity directly before using it for promotion.
      if (!settlementValidated && updated.settlementTransactionHash) {
        const receipt = await this.destinationProvider.getTransactionReceipt(updated.settlementTransactionHash);
        if (receipt) await applySettlementReceipt(receipt, updated.settlementTransactionHash);
      }
      const applyPayoutReceipt = async (receipt: any, fallbackHash?: string): Promise<boolean> => {
        const candidateHash = normalizeHex(String(receipt?.hash ?? fallbackHash ?? ''));
        if (updated.payoutTransactionHash && candidateHash !== normalizeHex(updated.payoutTransactionHash)) return false;
        if (receipt?.hash && fallbackHash && normalizeHex(String(receipt.hash)) !== normalizeHex(String(fallbackHash))) return false;
        if (!this.payoutEvidence(receipt, updated, policy)) return false;
        const hash = candidateHash;
        if (!/^0x[0-9a-f]{64}$/.test(hash)) return false;
        const block = await this.destinationProvider.getBlock(receipt.blockNumber).catch(() => null);
        updated = { ...updated, payoutTransactionHash: hash, payoutReceiptStatus: 1, payoutBlock: receipt.blockNumber, payoutGas: receipt.gasUsed?.toString() ?? null, payoutTimestamp: block ? new Date(Number(block.timestamp) * 1000).toISOString() : null, prizeClaimed: true, explorerLinks: { ...updated.explorerLinks, payout: this.destinationExplorer(hash) } };
        payoutValidated = true;
        return true;
      };
      for (const candidate of [...claimLogs].reverse()) {
        const receipt = await candidate.getTransactionReceipt();
        if (await applyPayoutReceipt(receipt, candidate.transactionHash)) break;
      }
      if (!payoutValidated && updated.payoutTransactionHash) {
        const receipt = await this.destinationProvider.getTransactionReceipt(updated.payoutTransactionHash);
        if (receipt) await applyPayoutReceipt(receipt, updated.payoutTransactionHash);
      }
      const boundSettlement = settlementValidated && this.hasBoundSettlementEvidence(updated) && this.policyMatchesJob(policy, updated);
      const boundPayout = payoutValidated && updated.payoutReceiptStatus === 1 && updated.prizeClaimed === true;
      if (policyState === 3 && boundSettlement && boundPayout) return this.save(updated, 'existing settlement and payout reconciled', transition(updated, 'CLAIMED', 'PASS', null, null, { policy, policyState: 3, productState: 'CLAIMED', submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null }));
      if (policyState === 2 && boundSettlement) return this.save(updated, 'existing settlement reconciled', transition(updated, 'SETTLEMENT_COMPLETE', 'PASS', 'ALREADY_SETTLED', null, { policy, policyState: 2, productState: 'CLAIMABLE', submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null }));
      if (policyState === 2 && !boundSettlement && !updated.settlementTransactionHash) {
        return this.save(updated, 'settled policy lacks a transaction identity', transition(updated, 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'destination policy is settled but no matching settlement receipt identity is available', { ...unvalidatedEvidence(), policy, policyState: 2, submissionPhase: phase, nextRetryAt: retryAt() }));
      }
      return this.save(updated, 'existing policy state awaiting evidence', transition(updated, policyState === 3 ? 'UNKNOWN' : 'SETTLEMENT_PENDING', 'UNKNOWN', 'UNKNOWN', 'policy state is advanced but matching public event evidence is incomplete', { ...unvalidatedEvidence(), policy, policyState, submissionPhase: phase, nextRetryAt: new Date(Date.now() + 30_000).toISOString() }));
    } catch (error) {
      return this.failOrRetry(job, error, 'existing settlement reconciliation failed');
    }
  }

  /**
   * A process can die after the submission state is fsynced but before ethers
   * returns a transaction hash.  The worker cannot safely manufacture a hash
   * or rebroadcast in that window.  Reconcile public policy/events first, then
   * retain the phase with an explicit uncertainty marker until an operator or
   * a later chain read resolves it.
   */
  private async recoverUncertainSubmission(job: WorkerJob): Promise<WorkerJob> {
    // The durable phase marker wins over a stale public state.  Older v1
    // records have no marker, so retain the state-based fallback for them.
    const payoutPhase = submissionPhaseOf(job) === 'PAYOUT';
    const terminalUncertaintyStates: JobState[] = ['NON_PAYABLE_RESULT', 'VERIFICATION_FAILED', 'REPLAY_REJECTED', 'PROOF_PREFLIGHT_FAIL'];
    if (!payoutPhase) {
      try {
        const reconciled = await this.reconcileExistingState(job);
        // Only a settlement transaction resolves an uncertain settlement
        // broadcast.  A payout hash can belong to a later claim and must not
        // make us assume that the ASC submission was observed.
        const boundSettlement = this.hasBoundSettlementEvidence(reconciled);
        if (reconciled.state === 'REFUNDED'
          || (boundSettlement && ['SETTLEMENT_COMPLETE', 'CLAIMABLE', 'CLAIMED'].includes(reconciled.state))) {
          return this.save(reconciled, 'uncertain settlement reconciled', { submissionUncertainty: false, submissionPhase: undefined });
        }
        // Source/policy validation failures are authoritative.  They must not
        // retain an uncertainty marker that suggests an unresolved broadcast
        // after reconciliation has already produced a terminal business
        // outcome.
        if (terminalUncertaintyStates.includes(reconciled.state)) {
          return this.save(reconciled, 'uncertain settlement resolved as terminal failure', { submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null });
        }
        // Preserve explicit policy and infrastructure phases so operators can
        // distinguish a missing policy from an unresolved settlement hash.
        if (['WAITING_FOR_POLICY', 'INFRASTRUCTURE_UNAVAILABLE'].includes(reconciled.state)) {
          return this.save(reconciled, 'uncertain settlement remains unresolved', {
            submissionUncertainty: true,
            submissionPhase: 'SETTLEMENT',
            nextRetryAt: reconciled.nextRetryAt ?? retryAt(),
          });
        }
        // reconcileExistingState normally returns a pending/unknown snapshot,
        // but it can return a stale MINED/SUBMITTING projection. Keep the phase explicit
        // for every other non-terminal no-hash outcome so a stale MINED or
        // SUBMITTING projection cannot re-enter a fresh proof/broadcast path.
        const pending = transition(reconciled, 'SETTLEMENT_PENDING', 'UNKNOWN', reconciled.lastErrorClass ?? 'UNKNOWN', reconciled.lastErrorMessage ?? 'settlement submission outcome is unknown; public reconciliation will be retried before any broadcast', {
          submissionUncertainty: true,
          submissionPhase: 'SETTLEMENT',
          nextRetryAt: reconciled.nextRetryAt ?? retryAt(),
        });
        return this.save(pending, 'uncertain settlement remains unresolved');
      } catch (error) {
        const classified = classifyError(error);
        return this.save(job, 'uncertain settlement reconciliation unavailable', transition(job, 'SETTLEMENT_PENDING', 'UNKNOWN', classified.errorClass, 'settlement submission outcome is unknown; public reconciliation will be retried before any broadcast', { submissionUncertainty: true, submissionPhase: 'SETTLEMENT', nextRetryAt: retryAt() }));
      }
    }

    let workingJob = job;
    try {
      // A payout-only receipt is insufficient if the settlement snapshot was
      // lost before the crash.  Reconcile both event streams first so a claim
      // cannot be attributed to an unbound source result.
      {
        const reconciled = await this.reconcileExistingState(workingJob);
        if (reconciled.state === 'CLAIMED'
          && this.hasBoundSettlementEvidence(reconciled)
          && reconciled.payoutReceiptStatus === 1
          && reconciled.prizeClaimed === true) {
          return this.save(reconciled, 'uncertain payout reconciled', { submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null });
        }
        if (reconciled.state === 'REFUNDED') {
          return this.save(reconciled, 'uncertain payout resolved by refund', { submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null });
        }
        if (terminalUncertaintyStates.includes(reconciled.state)) {
          return this.save(reconciled, 'uncertain payout resolved as terminal failure', { submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null });
        }
        // An absent or unfunded policy is an explicit wait state.  Keep the
        // uncertainty marker and stop here; falling through to the claim-log
        // scan could turn stale payout metadata into a rebroadcast decision.
        if (reconciled.state === 'WAITING_FOR_POLICY') {
          return this.save(reconciled, 'uncertain payout waiting for policy', {
            submissionUncertainty: true,
            submissionPhase: 'PAYOUT',
            nextRetryAt: reconciled.nextRetryAt ?? retryAt(),
          });
        }
        if (reconciled.state === 'INFRASTRUCTURE_UNAVAILABLE') {
          return this.save(reconciled, 'uncertain payout reconciliation unavailable', { submissionUncertainty: true, submissionPhase: 'PAYOUT', nextRetryAt: reconciled.nextRetryAt ?? retryAt() });
        }
        workingJob = reconciled;
      }
      const latestBlock = await this.destinationProvider.getBlockNumber();
      const from = Math.max(this.config.destinationDeploymentBlock, latestBlock - 100_000);
      const policy = await this.readPolicy(workingJob);
      const claimLogs = await (this.vault as any).queryFilter((this.vault as any).filters.PrizeClaimed(workingJob.tournamentId), from, latestBlock);
      for (const candidate of [...claimLogs].reverse()) {
        const receipt = await candidate.getTransactionReceipt();
        if (!this.payoutEvidence(receipt, workingJob, policy) || !this.hasBoundSettlementEvidence(workingJob)) continue;
        const hash = normalizeHex(String(receipt.hash ?? candidate.transactionHash ?? ''));
        if (!/^0x[0-9a-f]{64}$/.test(hash)) continue;
        const block = await this.destinationProvider.getBlock(receipt.blockNumber).catch(() => null);
        const updated = transition(workingJob, 'CLAIMED', 'PASS', null, null, {
          payoutTransactionHash: hash,
          payoutReceiptStatus: 1,
          payoutBlock: receipt.blockNumber,
          payoutGas: receipt.gasUsed?.toString() ?? null,
          payoutTimestamp: block ? new Date(Number(block.timestamp) * 1000).toISOString() : null,
          prizeClaimed: true,
          policy,
          policyState: Number(policy.state),
          productState: 'CLAIMED',
          submissionUncertainty: false,
          submissionPhase: undefined,
          explorerLinks: { ...job.explorerLinks, payout: this.destinationExplorer(hash) },
          nextRetryAt: null,
        });
        return this.save(updated, 'uncertain payout reconciled');
      }
      if (Number(policy.state) === 4) {
        return this.save(workingJob, 'uncertain payout resolved by refund', transition(workingJob, 'REFUNDED', 'PASS', 'POLICY_REFUNDED', 'policy was refunded before a payout receipt could be observed', { policy, policyState: 4, submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null }));
      }
      return this.save(workingJob, 'uncertain payout remains unresolved', transition(workingJob, 'PAYOUT_PENDING', 'UNKNOWN', 'UNKNOWN', 'payout submission outcome is unknown; no blind rebroadcast will be attempted', { policy, policyState: Number(policy.state), submissionUncertainty: true, submissionPhase: 'PAYOUT', nextRetryAt: retryAt() }));
    } catch (error) {
      const classified = classifyError(error);
      return this.save(workingJob, 'uncertain payout reconciliation unavailable', transition(workingJob, 'PAYOUT_PENDING', 'UNKNOWN', classified.errorClass, 'payout submission outcome is unknown; public reconciliation will be retried before any broadcast', { submissionUncertainty: true, submissionPhase: 'PAYOUT', nextRetryAt: retryAt() }));
    }
  }

  private async reconcileSettlement(job: WorkerJob, proof: ProofData | null): Promise<WorkerJob> {
    if (!job.settlementTransactionHash) return job;
    const receipt = await this.destinationProvider.getTransactionReceipt(job.settlementTransactionHash);
    if (!receipt) return this.save(job, 'settlement receipt pending', transition(job, 'SETTLEMENT_PENDING', 'UNKNOWN', 'RPC_UNAVAILABLE', 'settlement transaction is submitted but receipt is not visible', { submissionUncertainty: false, submissionPhase: 'SETTLEMENT', nextRetryAt: retryAt() }));
    const status = receiptStatus(receipt.status);
    if (status === null) return this.save(job, 'settlement receipt status unknown', transition(job, 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'settlement receipt returned an invalid status; reconciliation will retry', { submissionUncertainty: false, submissionPhase: 'SETTLEMENT', settlementReceiptStatus: null, settlementBlock: null, settlementGas: null, settlementTimestamp: null, nextRetryAt: retryAt() }));
    if (status === 0) {
      // A concurrent actor may have settled the same policy while this
      // transaction was pending.  Reconcile public policy/events before
      // treating the failed transaction as the terminal result; otherwise a
      // legitimate alternate settlement is misreported as a worker failure.
      const reconciled = await this.reconcileExistingState(job);
      // Use the normalized transaction identity when comparing a possible
      // alternate settlement.  More importantly, decide from the explicit
      // reconciled state rather than object identity: a reconciler may return
      // the same journal object after refreshing it in place, and treating
      // that as "no reconciliation" would overwrite a fresh wait/unknown
      // result with a misleading terminal failure.
      const reconciledSettlementHash = normalizeHex(String(reconciled.settlementTransactionHash ?? ''));
      const assignedSettlementHash = normalizeHex(String(job.settlementTransactionHash));
      const alternateSettlement = /^0x[0-9a-f]{64}$/.test(reconciledSettlementHash)
        && reconciledSettlementHash !== assignedSettlementHash;
      const policyAdvanced = [2, 3, 4].includes(Number(reconciled.policyState));
      const reconciliationUncertain = ['WAITING_FOR_POLICY', 'UNKNOWN', 'INFRASTRUCTURE_UNAVAILABLE'].includes(reconciled.state);
      const boundReconciledSettlement = Boolean(reconciled.settlementTransactionHash)
        && reconciled.settlementReceiptStatus === 1
        && reconciled.resultVerified === true
        && reconciled.tournamentSettled === true;
      const reconciliationResolved = reconciled.state === 'REFUNDED'
        || (boundReconciledSettlement && ['SETTLEMENT_COMPLETE', 'CLAIMABLE', 'CLAIMED'].includes(reconciled.state));
      const terminalReconciliation = ['NON_PAYABLE_RESULT', 'VERIFICATION_FAILED', 'REPLAY_REJECTED', 'PROOF_PREFLIGHT_FAIL'].includes(reconciled.state);
      if (alternateSettlement || policyAdvanced || reconciliationUncertain || reconciliationResolved || terminalReconciliation) {
        const terminalResolution = reconciled.state === 'REFUNDED'
          || terminalReconciliation
          || (boundReconciledSettlement && ['SETTLEMENT_COMPLETE', 'CLAIMABLE', 'CLAIMED'].includes(reconciled.state));
        return this.save(reconciled, 'failed settlement reconciled against destination state', {
          submissionUncertainty: terminalResolution ? false : true,
          submissionPhase: terminalResolution ? undefined : 'SETTLEMENT',
          nextRetryAt: terminalResolution ? null : (reconciled.nextRetryAt ?? retryAt()),
        });
      }
      return this.save(job, 'settlement mined failure', transition(job, 'VERIFICATION_FAILED', 'FAIL', 'SEMANTIC_REJECTION', 'settlement transaction mined with status 0', { submissionUncertainty: false, submissionPhase: undefined, settlementReceiptStatus: status, settlementBlock: receipt.blockNumber, settlementGas: receipt.gasUsed?.toString() ?? null, nextRetryAt: null }));
    }
    const ascInterface = new Interface(ASC_ABI);
    const vaultInterface = new Interface(VAULT_ABI);
    const resultVerified = Boolean(this.parsedReceiptEvent(receipt, ascInterface, 'ResultVerified', this.config.asc));
    const tournamentSettled = Boolean(this.parsedReceiptEvent(receipt, vaultInterface, 'TournamentSettled', this.config.vault));
    if (!resultVerified || !tournamentSettled) return this.save(job, 'settlement receipt missing expected events', transition(job, 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'settlement receipt succeeded but ResultVerified/TournamentSettled evidence is incomplete', { submissionUncertainty: false, submissionPhase: 'SETTLEMENT', settlementReceiptStatus: status, settlementBlock: receipt.blockNumber, settlementGas: receipt.gasUsed?.toString() ?? null, resultVerified, tournamentSettled, nextRetryAt: retryAt() }));
    const policy = await this.readPolicy(job);
    const expectedQueryKey = proof ? keccak256(proofToQuery(proof).encodedTransaction) : String(policy.sourceQueryKey ?? '');
    const boundEvidence = this.settlementEvidence(receipt, job, policy, expectedQueryKey);
    if (!boundEvidence.resultVerified || !boundEvidence.tournamentSettled) return this.save(job, 'settlement receipt missing bound events', transition(job, 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'settlement receipt succeeded but bound ResultVerified/TournamentSettled evidence is incomplete', { submissionUncertainty: false, submissionPhase: 'SETTLEMENT', settlementReceiptStatus: status, settlementBlock: receipt.blockNumber, settlementGas: receipt.gasUsed?.toString() ?? null, resultVerified: boundEvidence.resultVerified, tournamentSettled: boundEvidence.tournamentSettled, nextRetryAt: retryAt() }));
    if (Number(policy.state) !== 2 && Number(policy.state) !== 3) return this.save(job, 'settlement receipt lacks claimable policy', transition(job, 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'settlement receipt succeeded but policy state is not claimable/claimed', { submissionUncertainty: false, submissionPhase: 'SETTLEMENT', settlementReceiptStatus: status, settlementBlock: receipt.blockNumber, settlementGas: receipt.gasUsed?.toString() ?? null, resultVerified: true, tournamentSettled: true, policy, policyState: Number(policy.state), nextRetryAt: retryAt() }));
    const settlementBlock = await this.destinationProvider.getBlock(receipt.blockNumber).catch(() => null);
    const updated = transition(job, 'SETTLEMENT_COMPLETE', 'PASS', null, null, { submissionUncertainty: false, submissionPhase: undefined, settlementReceiptStatus: status, settlementBlock: receipt.blockNumber, settlementGas: receipt.gasUsed?.toString() ?? null, settlementTimestamp: settlementBlock ? new Date(Number(settlementBlock.timestamp) * 1000).toISOString() : null, resultVerified: true, tournamentSettled: true, policy, policyState: Number(policy.state), productState: 'CLAIMABLE', explorerLinks: { ...job.explorerLinks, settlement: this.destinationExplorer(job.settlementTransactionHash) }, nextRetryAt: null });
    // A CLAIMED policy is not sufficient payout evidence by itself.  The
    // payout transaction and PrizeClaimed receipt must also be recorded;
    // otherwise a settlement reconciliation could falsely report CLAIMED
    // after an unrelated/unknown claim or a partially observed RPC result.
    if (Number(policy.state) === 3 && updated.payoutReceiptStatus !== 1) return this.reconcileExistingState(updated);
    return this.save(updated, 'settlement receipt reconciled');
  }

  private async submitSettlement(job: WorkerJob, proof: ProofData): Promise<WorkerJob> {
    if (!this.workerSigner) return this.save(job, 'settlement signer unavailable', transition(job, 'INFRASTRUCTURE_UNAVAILABLE', 'UNKNOWN', 'INVALID_CONFIGURATION', 'WORKER_PRIVATE_KEY is not configured; no transaction was submitted', { submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null }));
    const admission = await this.admit(job);
    if (admission.kind === 'ALREADY_SETTLED') {
      const observed = { ...job, policy: admission.policy, policyState: admission.policyState };
      if (typeof (this as any).reconcileExistingState === 'function') return this.reconcileExistingState(observed);
      return this.save(observed, 'existing settlement observed', transition(observed, 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'policy is settled but matching settlement receipt evidence is not yet available', { nextRetryAt: retryAt() }));
    }
    if (admission.kind !== 'ACCEPTED') {
      if (admission.kind === 'NON_PAYABLE_RESULT') return this.save(job, 'non-payable result', transition(job, 'NON_PAYABLE_RESULT', 'FAIL', null, admission.message, { submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null }));
      if (admission.kind === 'PERMANENT_FAILURE') return this.save(job, 'permanent admission failure', transition(job, 'VERIFICATION_FAILED', 'FAIL', admission.errorClass, admission.message, { submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null }));
      if (admission.kind === 'REFUNDED') return this.save(job, 'policy refunded', transition(job, 'REFUNDED', 'PASS', 'POLICY_REFUNDED', admission.policy ? 'policy is refunded' : null, { policy: admission.policy, policyState: admission.policyState, submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null }));
      if (admission.kind === 'WAITING_FOR_POLICY') return this.save(job, 'policy admission deferred', transition(job, 'WAITING_FOR_POLICY', 'UNKNOWN', admission.errorClass, admission.message, { submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: new Date(Date.now() + 30_000).toISOString() }));
      return this.save(job, 'policy read unavailable', transition(job, 'INFRASTRUCTURE_UNAVAILABLE', 'UNKNOWN', admission.errorClass, admission.message, { submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: new Date(Date.now() + 30_000).toISOString() }));
    }
    if (typeof (this as any).reconcileExistingState === 'function') {
      const reconciled = await this.reconcileExistingState(job);
      // Reconciliation is authoritative for the policy state immediately
      // before a broadcast.  Only a still-funded MINED projection may proceed
      // to proof submission; every other returned state must be preserved.
      // A proof-ready job is intentionally preserved by reconciliation while
      // the policy remains funded. It is safe to broadcast from that phase
      // because the proof has already passed preflight; only the destination
      // policy state must still be FUNDED.
      if (!['MINED', 'PROOF_PREFLIGHT_PASS'].includes(reconciled.state) || Number(reconciled.policyState) !== 1) return reconciled;
      job = reconciled;
    }
    const query = proofToQuery(proof);
    const queryKey = keccak256(query.encodedTransaction);
    if (await this.asc.usedSourceQueries(queryKey)) return this.save(job, 'source query replay detected', transition(job, 'REPLAY_REJECTED', 'FAIL', 'REPLAYED', 'source query mapping is already consumed', { replayEvidence: { sourceQueryKey: queryKey, detectedAt: new Date().toISOString() }, submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null }));
    const businessKey = keccak256(AbiCoder.defaultAbiCoder().encode(['uint64', 'address', 'bytes32', 'uint256'], [query.chainKey, this.config.sourceRegistry, job.tournamentId, job.resultNonce]));
    if (await this.asc.usedBusinessResults(businessKey)) return this.save(job, 'business replay detected', transition(job, 'REPLAY_REJECTED', 'FAIL', 'REPLAYED', 'business result mapping is already consumed', { replayEvidence: { businessKey, detectedAt: new Date().toISOString() }, submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null }));
    let response: any;
    try {
      const submitting = transition(job, 'SUBMITTING', 'UNKNOWN', null, null, { attemptCount: job.attemptCount + 1, submissionPhase: 'SETTLEMENT', nextRetryAt: null });
      this.assertLease();
      job = await this.save(submitting, 'settlement submission started');
      this.assertLease();
      response = await this.asc.verifyAndSettle(0, query.chainKey, query.blockHeight, query.encodedTransaction, query.merkleRoot, query.siblings, query.lowerEndpointDigest, query.continuityRoots, { gasLimit: 3_000_000 });
      const submittedHash = normalizeHex(String(response?.hash ?? ''));
      if (!/^0x[0-9a-f]{64}$/.test(submittedHash)) throw new Error('settlement submission returned no transaction hash');
      job = await this.save(job, 'settlement transaction hash persisted', { state: 'SETTLEMENT_PENDING', productState: 'SETTLEMENT_PENDING', settlementTransactionHash: submittedHash, submissionPhase: 'SETTLEMENT', explorerLinks: { ...job.explorerLinks, settlement: this.destinationExplorer(submittedHash) }, nextRetryAt: null });
    } catch (error) {
      return this.failOrRetry(job, error, 'settlement submission failed');
    }
    try {
      const receipt = await this.waitForReceipt(this.destinationProvider, job.settlementTransactionHash!);
      if (!receipt) return this.save(job, 'settlement wait timed out', transition(job, 'SETTLEMENT_PENDING', 'UNKNOWN', 'RPC_UNAVAILABLE', 'receipt wait timed out; reconciliation will inspect the submitted hash', { submissionPhase: 'SETTLEMENT', nextRetryAt: new Date(Date.now() + 30_000).toISOString() }));
      return this.reconcileSettlement(job, proof);
    } catch (error) {
      const classified = classifyError(error);
      return this.save(job, 'settlement reconciliation unavailable', transition(job, 'SETTLEMENT_PENDING', 'UNKNOWN', classified.errorClass, classified.message, { submissionPhase: 'SETTLEMENT', nextRetryAt: new Date(Date.now() + 30_000).toISOString() }));
    }
  }

  private async reconcilePayout(job: WorkerJob): Promise<WorkerJob> {
    if (!job.payoutTransactionHash) return job;
    // Re-read and validate the settlement receipt before using any persisted
    // settlement booleans.  A payout receipt by itself is not proof that this
    // source result was settled.
    let workingJob = await this.reconcileExistingState({ ...job, state: 'SETTLEMENT_COMPLETE', productState: 'CLAIMABLE', outcome: 'UNKNOWN', evidenceOutcome: 'UNKNOWN' });
    if (workingJob.state === 'CLAIMED' || workingJob.state === 'REFUNDED') return this.save(workingJob, 'payout reconciliation already terminal', { submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null });
    if (workingJob.state === 'WAITING_FOR_POLICY' || workingJob.state === 'INFRASTRUCTURE_UNAVAILABLE' || workingJob.state === 'UNKNOWN') return this.save(workingJob, 'payout reconciliation remains unresolved', { submissionPhase: 'PAYOUT', nextRetryAt: workingJob.nextRetryAt ?? retryAt() });
    if (!this.hasBoundSettlementEvidence(workingJob)) return workingJob;
    const receipt = await this.destinationProvider.getTransactionReceipt(workingJob.payoutTransactionHash!);
    if (!receipt) return this.save(workingJob, 'payout receipt pending', transition(workingJob, 'PAYOUT_PENDING', 'UNKNOWN', 'RPC_UNAVAILABLE', 'payout transaction is submitted but receipt is not visible', { submissionUncertainty: false, submissionPhase: 'PAYOUT', nextRetryAt: retryAt() }));
    const status = receiptStatus(receipt.status);
    if (status === null) return this.save(workingJob, 'payout receipt status unknown', transition(workingJob, 'PAYOUT_PENDING', 'UNKNOWN', 'UNKNOWN', 'payout receipt returned an invalid status; reconciliation will retry', { submissionUncertainty: false, submissionPhase: 'PAYOUT', payoutReceiptStatus: null, payoutBlock: null, payoutGas: null, payoutTimestamp: null, nextRetryAt: retryAt() }));
    if (status === 0) {
      const failedPolicy = await this.readPolicy(workingJob).catch(() => null);
      if (Number(failedPolicy?.state) === 3) return this.reconcileExistingState({ ...workingJob, payoutReceiptStatus: status, payoutBlock: receipt.blockNumber, payoutGas: receipt.gasUsed?.toString() ?? null });
      return this.save(workingJob, 'payout mined failure', transition(workingJob, 'VERIFICATION_FAILED', 'FAIL', 'SEMANTIC_REJECTION', 'payout transaction mined with status 0', { submissionUncertainty: false, submissionPhase: undefined, payoutReceiptStatus: status, payoutBlock: receipt.blockNumber, payoutGas: receipt.gasUsed?.toString() ?? null, nextRetryAt: null }));
    }
    const policy = await this.readPolicy(workingJob);
    const prizeClaimed = this.payoutEvidence(receipt, workingJob, policy);
    if (!prizeClaimed) return this.save(workingJob, 'payout receipt missing PrizeClaimed', transition(workingJob, 'PAYOUT_PENDING', 'UNKNOWN', 'UNKNOWN', 'payout receipt succeeded but PrizeClaimed evidence is incomplete', { submissionUncertainty: false, submissionPhase: 'PAYOUT', payoutReceiptStatus: status, payoutBlock: receipt.blockNumber, payoutGas: receipt.gasUsed?.toString() ?? null, nextRetryAt: retryAt() }));
    if (!this.hasBoundSettlementEvidence(workingJob)) return this.save(workingJob, 'payout receipt lacks bound settlement evidence', transition(workingJob, 'PAYOUT_PENDING', 'UNKNOWN', 'UNKNOWN', 'payout receipt succeeded but matching settlement receipt evidence is incomplete', { submissionUncertainty: false, submissionPhase: 'PAYOUT', payoutReceiptStatus: status, payoutBlock: receipt.blockNumber, payoutGas: receipt.gasUsed?.toString() ?? null, policy, policyState: Number(policy.state), nextRetryAt: retryAt() }));
    if (Number(policy.state) !== 3) return this.save(workingJob, 'payout receipt lacks claimed policy', transition(workingJob, 'PAYOUT_PENDING', 'UNKNOWN', 'RPC_UNAVAILABLE', 'payout receipt succeeded but policy is not CLAIMED', { submissionUncertainty: false, submissionPhase: 'PAYOUT', payoutReceiptStatus: status, payoutBlock: receipt.blockNumber, payoutGas: receipt.gasUsed?.toString() ?? null, policy, policyState: Number(policy.state), nextRetryAt: retryAt() }));
    const payoutBlock = await this.destinationProvider.getBlock(receipt.blockNumber).catch(() => null);
    const updated = transition(workingJob, 'CLAIMED', 'PASS', null, null, { submissionUncertainty: false, submissionPhase: undefined, payoutReceiptStatus: status, payoutBlock: receipt.blockNumber, payoutGas: receipt.gasUsed?.toString() ?? null, payoutTimestamp: payoutBlock ? new Date(Number(payoutBlock.timestamp) * 1000).toISOString() : null, prizeClaimed, policy, policyState: 3, productState: 'CLAIMED', explorerLinks: { ...workingJob.explorerLinks, payout: this.destinationExplorer(workingJob.payoutTransactionHash!) }, nextRetryAt: null });
    return this.save(updated, 'payout receipt reconciled');
  }

  private async submitPayout(job: WorkerJob): Promise<WorkerJob> {
    if (!this.config.autoClaim) {
      if (job.state === 'CLAIMABLE' && job.productState === 'CLAIMABLE' && job.outcome === 'PASS' && job.policyState === 2 && this.hasBoundSettlementEvidence(job) && !job.payoutTransactionHash && !job.submissionUncertainty && !job.nextRetryAt) return job;
      if (!this.hasBoundSettlementEvidence(job)) return this.save(job, 'automatic claim disabled without settlement evidence', transition(job, 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'automatic claim is disabled and current settlement receipt evidence is incomplete', { submissionPhase: job.submissionUncertainty === true ? submissionPhaseOf(job) : undefined, nextRetryAt: retryAt() }));
      return this.save(job, 'automatic claim disabled', transition(job, 'CLAIMABLE', 'PASS', null, null, { productState: 'CLAIMABLE', submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null }));
    }
    if (!this.workerSigner) return this.save(job, 'payout signer unavailable', transition(job, 'CLAIMABLE', 'UNKNOWN', 'INVALID_CONFIGURATION', 'automatic claim is enabled but WORKER_PRIVATE_KEY is absent', { productState: 'CLAIMABLE', submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null }));
    const policy = await this.readPolicy(job);
    if (Number(policy.state) === 3) return this.reconcileExistingState(job);
    if (Number(policy.state) === 4) return this.save(job, 'policy refunded before payout', transition(job, 'REFUNDED', 'PASS', 'POLICY_REFUNDED', 'policy was refunded before payout submission', { policy, policyState: 4, submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null }));
    if (Number(policy.state) !== 2) return this.save(job, 'claimable policy not observed', transition(job, 'CLAIMABLE', 'UNKNOWN', 'RPC_UNAVAILABLE', 'policy is not CLAIMABLE; payout was not submitted', { policy, policyState: Number(policy.state), productState: 'CLAIMABLE', submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: retryAt() }));
    if (!this.policyMatchesJob(policy, job)) return this.save(job, 'claim policy predicate mismatch', transition(job, 'VERIFICATION_FAILED', 'FAIL', 'INVALID_INPUT', 'claim policy predicates do not match the durable source result; payout was not submitted', { policy, policyState: Number(policy.state), submissionUncertainty: false, submissionPhase: undefined, nextRetryAt: null }));
    if (typeof (this as any).reconcileExistingState === 'function') {
      const reconciled = await this.reconcileExistingState(job);
      // Do not submit a claim after reconciliation observes an absent,
      // unfunded, refunded, failed, or otherwise unknown policy.  The only
      // states that can continue are a valid claimable projection (or the
      // unchanged test/runtime snapshot when no reconciliation occurred).
      if (!['SETTLEMENT_COMPLETE', 'CLAIMABLE'].includes(reconciled.state)) return reconciled;
      job = reconciled;
    }
    try {
      const pending = transition(job, 'PAYOUT_PENDING', 'UNKNOWN', null, null, { attemptCount: job.attemptCount + 1, submissionUncertainty: false, submissionPhase: 'PAYOUT', nextRetryAt: null });
      this.assertLease();
      job = await this.save(pending, 'payout submission started');
      this.assertLease();
      const response = await this.vault.claimFor(job.tournamentId, { gasLimit: 500_000 });
      const submittedHash = normalizeHex(String(response?.hash ?? ''));
      if (!/^0x[0-9a-f]{64}$/.test(submittedHash)) throw new Error('payout submission returned no transaction hash');
      job = await this.save(job, 'payout transaction hash persisted', { payoutTransactionHash: submittedHash, submissionUncertainty: false, submissionPhase: 'PAYOUT', explorerLinks: { ...job.explorerLinks, payout: this.destinationExplorer(submittedHash) }, nextRetryAt: null });
    } catch (error) {
      return this.failOrRetry(job, error, 'payout submission failed');
    }
    try {
      const receipt = await this.waitForReceipt(this.destinationProvider, job.payoutTransactionHash!);
      if (!receipt) return this.save(job, 'payout wait timed out', transition(job, 'PAYOUT_PENDING', 'UNKNOWN', 'RPC_UNAVAILABLE', 'payout receipt wait timed out; reconciliation will inspect the submitted hash', { submissionPhase: 'PAYOUT', nextRetryAt: retryAt() }));
      return this.reconcilePayout(job);
    } catch (error) {
      const classified = classifyError(error);
      return this.save(job, 'payout reconciliation unavailable', transition(job, 'PAYOUT_PENDING', 'UNKNOWN', classified.errorClass, classified.message, { submissionPhase: 'PAYOUT', nextRetryAt: retryAt() }));
    }
  }

  private async processJob(job: WorkerJob): Promise<void> {
    // A CLAIMED journal snapshot is only a projection.  It must be
    // reconciled against the destination receipts before it is treated as a
    // terminal success; persisted booleans alone are not evidence.
    if (isTerminalState(job.state) && !['CLAIMED', 'ALREADY_SETTLED'].includes(job.state)) return;
    const requiresFreshProjection = job.state === 'CLAIMED' || job.state === 'ALREADY_SETTLED';
    if (job.nextRetryAt && Date.parse(job.nextRetryAt) > Date.now() && !requiresFreshProjection) return;
    const owner = this.runtimeId;
    const leased = await this.store.claimLease(job.jobId, owner, this.config.leaseTtlMs);
    if (!leased) return;
    this.activeLeaseOwner = owner;
    this.leaseLost = false;
    const renewer = setInterval(() => {
      void this.store.renewLease(job.jobId, owner, this.config.leaseTtlMs)
        .then((renewed) => {
          if (!renewed) {
            this.leaseLost = true;
            logEvent('worker_lease_lost', { jobId: job.jobId, owner });
          }
        })
        .catch((error) => {
          this.leaseLost = true;
          logEvent('worker_lease_renewal_failed', { jobId: job.jobId, owner, error: safeError(error) });
        });
    }, Math.max(1_000, Math.floor(this.config.leaseTtlMs / 2)));
    try {
      job = leased;
      this.assertLease();
      // A crash can leave SUBMITTING/PAYOUT_PENDING durable without a hash.
      // Reconcile public policy/events first and never enter a fresh broadcast
      // path while the submission outcome remains uncertain.
      const phase = submissionPhaseOf(job);
      const missingSettlementHash = phase === 'SETTLEMENT' && !job.settlementTransactionHash;
      const missingPayoutHash = phase === 'PAYOUT' && !job.payoutTransactionHash;
      if (missingSettlementHash || missingPayoutHash || job.submissionUncertainty === true) {
        job = await this.recoverUncertainSubmission(job);
        const recoveredPhase = submissionPhaseOf(job);
        const unresolvedSettlement = recoveredPhase === 'SETTLEMENT' && !job.settlementTransactionHash;
        const unresolvedPayout = recoveredPhase === 'PAYOUT' && !job.payoutTransactionHash;
        if (job.submissionUncertainty === true || unresolvedSettlement || unresolvedPayout) return;
      }
      // Older workers could mark a policy CLAIMED from a state read before
      // the PrizeClaimed receipt was correlated.  Such a record is not
      // terminal evidence; reconcile the public event log before honoring the
      // terminal-state guard.
      if (job.state === 'CLAIMED' || job.state === 'ALREADY_SETTLED') {
        job = await this.reconcileExistingState({ ...job, state: 'SETTLEMENT_COMPLETE', productState: 'CLAIMABLE', outcome: 'UNKNOWN', evidenceOutcome: 'UNKNOWN' });
      }
      if (job.state === 'UNKNOWN') {
        job = await this.reconcileExistingState(job);
      }
      if (job.settlementTransactionHash && ['SETTLEMENT_PENDING', 'SUBMITTING', 'SETTLEMENT_COMPLETE', 'CLAIMABLE', 'PAYOUT_PENDING'].includes(job.state)) {
        job = await this.reconcileSettlement(job, null);
      }
      if (job.payoutTransactionHash && job.state === 'PAYOUT_PENDING') job = await this.reconcilePayout(job);
      if (isTerminalState(job.state)) return;
      if (job.state === 'WAITING_FOR_POLICY' || job.state === 'MINED' || job.state === 'INFRASTRUCTURE_UNAVAILABLE') {
        const admission = await this.admit(job);
        if (admission.kind === 'WAITING_FOR_POLICY') { await this.save(job, 'policy admission deferred', transition(job, 'WAITING_FOR_POLICY', 'UNKNOWN', admission.errorClass, admission.message, { nextRetryAt: new Date(Date.now() + 30_000).toISOString() })); return; }
        if (admission.kind === 'NON_PAYABLE_RESULT') { await this.save(job, 'non-payable result', transition(job, 'NON_PAYABLE_RESULT', 'FAIL', null, admission.message, { nextRetryAt: null })); return; }
        if (admission.kind === 'PERMANENT_FAILURE') { await this.save(job, 'permanent admission failure', transition(job, 'VERIFICATION_FAILED', 'FAIL', admission.errorClass, admission.message, { nextRetryAt: null })); return; }
        if (admission.kind === 'REFUNDED') { await this.save(job, 'policy refunded', transition(job, 'REFUNDED', 'PASS', 'POLICY_REFUNDED', 'policy is refunded', { policy: admission.policy, policyState: admission.policyState, nextRetryAt: null })); return; }
        if (admission.kind === 'ALREADY_SETTLED') { await this.save(job, 'already settled policy', transition(job, 'SETTLEMENT_COMPLETE', 'PASS', 'ALREADY_SETTLED', 'policy is settled; public settlement and payout events will be reconciled before a terminal state is reported', { policy: admission.policy, policyState: admission.policyState, productState: 'CLAIMABLE', nextRetryAt: null })); return; }
        if (admission.kind === 'INFRASTRUCTURE_UNAVAILABLE') { await this.save(job, 'policy read unavailable', transition(job, 'INFRASTRUCTURE_UNAVAILABLE', 'UNKNOWN', admission.errorClass, admission.message, { nextRetryAt: new Date(Date.now() + 30_000).toISOString() })); return; }
        job = await this.save(job, 'policy admission accepted', { policy: admission.policy, policyState: Number(admission.policy.state), state: 'MINED', productState: 'MINED', outcome: 'PASS', evidenceOutcome: 'PASS', nextRetryAt: null });
      }
      if (job.state === 'SETTLEMENT_COMPLETE' || job.state === 'CLAIMABLE') {
        job = await this.reconcileExistingState(job);
        // Reconciliation may downgrade a stale projection to WAITING,
        // MINED, REFUNDED, or a semantic failure.  Never run the payout path
        // merely because the pre-reconciliation snapshot looked claimable.
        if (!['SETTLEMENT_COMPLETE', 'CLAIMABLE'].includes(job.state)) return;
        if (job.state === 'SETTLEMENT_PENDING' || job.state === 'UNKNOWN') return;
        if (job.state === 'CLAIMED') return;
        await this.submitPayout(job);
        return;
      }
      // A process can crash while the proof request is in flight.  On restart,
      // AWAITING_ATTESTATION is therefore resumable and must re-enter the
      // proof acquisition path instead of being leased and silently skipped.
      if (!isProofResumableState(job.state)) return;
      const waiting = transition(job, 'AWAITING_ATTESTATION', 'UNKNOWN', null, null, { proofStatus: 'PENDING', attemptCount: job.attemptCount + 1, nextRetryAt: null });
      job = await this.save(waiting, 'proof requested');
      let proofResult: { proof: ProofData; verified: boolean };
      const proofStartedAt = Date.now();
      try {
        proofResult = await getAttestcoinProof(this.config.sourceRpc, this.config.destinationRpc, this.config.proverUrl, job.sourceTransactionHash, this.config.sourceChainKey, this.config.expectedChainInfo, this.config.expectedBlockProver);
      } catch (error) {
        await this.failOrRetry(job, error, 'proof acquisition failed');
        return;
      }
      const proof = proofResult.proof;
      if (!validProofShape(proof)) {
        await this.save(job, 'malformed proof shape', transition(job, 'PROOF_PREFLIGHT_FAIL', 'FAIL', 'MALFORMED_PROOF', 'proof payload shape is invalid', { proofStatus: 'PREFLIGHT_FAIL', proofPreflightOutcome: 'FAIL', nextRetryAt: null }));
        return;
      }
      const proofReady = transition(job, 'PROOF_READY', 'PASS', null, null, { proofStatus: 'AVAILABLE', proofHeader: proof.headerNumber, proofDigest: keccak256(proof.txBytes), proofCached: proof.cached ?? null, proofLatencyMs: Date.now() - proofStartedAt, nextRetryAt: null });
      job = await this.save(proofReady, 'proof available');
      if (Number(proof.chainKey) !== this.config.sourceChainKey || !proof.txHash || normalizeHex(proof.txHash) !== job.sourceTransactionHash || Number(proof.headerNumber) !== job.sourceBlockNumber) {
        await this.save(job, 'malformed proof identifiers', transition(job, 'PROOF_PREFLIGHT_FAIL', 'FAIL', 'MALFORMED_PROOF', 'proof identifiers do not match the source job', { proofStatus: 'PREFLIGHT_FAIL', proofPreflightOutcome: 'FAIL', nextRetryAt: null }));
        return;
      }
      const query = proofToQuery(proof);
      const digest = keccak256(query.encodedTransaction);
      if (!proofResult.verified) {
        await this.save(job, 'native proof preflight failed', transition(job, 'PROOF_PREFLIGHT_FAIL', 'FAIL', 'PROOF_REJECTED', 'CC3 native Block Prover rejected the proof', { proofStatus: 'PREFLIGHT_FAIL', proofHeader: proof.headerNumber, proofDigest: digest, proofCached: proof.cached ?? null, proofPreflightOutcome: 'FAIL', nextRetryAt: null }));
        return;
      }
      job = await this.save(job, 'native proof preflight passed', transition(job, 'PROOF_PREFLIGHT_PASS', 'PASS', null, null, { proofStatus: 'PREFLIGHT_PASS', proofHeader: proof.headerNumber, proofDigest: digest, proofCached: proof.cached ?? null, proofPreflightOutcome: 'PASS', nextRetryAt: null }));
      job = await this.submitSettlement(job, proof);
      if (job.state === 'SETTLEMENT_COMPLETE' || job.state === 'CLAIMABLE') await this.submitPayout(job);
    } catch (error) {
      // Losing the lease is a fencing event, not a job failure that this
      // runtime is still authorized to persist.  Abandon the attempt and let
      // a later loop/runtime reconcile the durable state after lease expiry.
      if (this.leaseLost || String((error as Error)?.message ?? error).includes('LEASE_LOST')) {
        logEvent('worker_job_abandoned_after_lease_loss', { jobId: job.jobId, owner, error: safeError(error) });
        return;
      }
      await this.failOrRetry(job, error, 'worker job processing failed');
    } finally {
      clearInterval(renewer);
      await this.store.releaseLease(job.jobId, owner).catch((error) => logEvent('worker_lease_release_failed', { jobId: job.jobId, owner, error: safeError(error) }));
      this.activeLeaseOwner = null;
      this.leaseLost = false;
    }
  }

  async reconcile(): Promise<void> {
    for (const job of this.store.getJobs()) {
      if (isTerminalState(job.state) && !['CLAIMED', 'ALREADY_SETTLED'].includes(job.state)) continue;
      if (job.settlementTransactionHash
        || job.payoutTransactionHash
        || job.state === 'SUBMITTING'
        || job.state === 'PAYOUT_PENDING'
        || job.state === 'CLAIMED'
        || job.state === 'ALREADY_SETTLED'
        || job.state === 'UNKNOWN'
        || job.submissionUncertainty === true
        || job.submissionPhase === 'SETTLEMENT'
        || job.submissionPhase === 'PAYOUT') await this.processJob(job);
    }
  }

  async runOnce(): Promise<void> {
    if (this.loopInFlight || this.stopping) return;
    this.loopInFlight = true;
    let complete!: () => void;
    this.loopIdle = new Promise<void>((resolve) => { complete = resolve; });
    this.lastLoopAt = new Date().toISOString();
    try {
      await this.store.setWorkerHeartbeat({ owner: this.runtimeId, at: this.lastLoopAt });
      if (this.configuration.outcome === 'UNKNOWN') await this.validateConfiguration();
      if (this.configuration.outcome !== 'PASS') return;
      try { await this.reconcile(); } catch (error) { logEvent('reconciliation_failed', { error: safeError(error) }); }
      try {
        await this.discoverRange();
      } catch (error) {
        const classified = classifyError(error);
        this.sourceDiscoveryCheck = { outcome: classified.retryable ? 'UNKNOWN' : 'FAIL', message: classified.message };
        logEvent('source_discovery_failed', { outcome: this.sourceDiscoveryCheck.outcome, errorClass: classified.errorClass, error: classified.message, retry: classified.retryable });
      }
      for (const job of this.store.getJobs()) await this.processJob(job);
    } finally {
      this.loopInFlight = false;
      complete();
    }
  }

  async start(): Promise<void> {
    const validation = await this.validateConfiguration();
    if (this.stopping) return;
    if (validation.outcome === 'FAIL') throw new Error(validation.message ?? 'worker configuration validation failed');
    if (!this.workerSigner) throw new Error('WORKER_PRIVATE_KEY is required to start the settlement worker');
    this.running = true;
    await this.runOnce();
    if (this.stopping) return;
    this.timer = setInterval(() => { void this.runOnce(); }, this.config.pollIntervalMs);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Finish an in-flight journal/chain reconciliation before normal exit.
    // The service supervisor bounds this drain if a dependency never returns.
    await this.loopIdle;
  }

  async health(): Promise<WorkerHealth> {
    let refreshError: unknown;
    try { await this.store.refresh(); } catch (error) { refreshError = error; }
    const persistence = refreshError
      ? { outcome: 'FAIL' as const, message: safeError(refreshError) }
      : await this.store.health();
    const heartbeat = this.store.getWorkerHeartbeat();
    const activeLease = this.store.getJobs().find((job) => job.lease && Date.parse(job.lease.expiresAt) > Date.now());
    const heartbeatFresh = heartbeat ? Date.now() - Date.parse(heartbeat.at) <= Math.max(this.config.pollIntervalMs * 3, this.config.leaseTtlMs) : false;
    const workerObserved = this.running || heartbeatFresh || Boolean(activeLease);
    const result: WorkerHealth = {
      api: { outcome: 'PASS' },
      configuration: this.configuration,
      persistence,
      sourceRpc: { outcome: 'UNKNOWN' },
      sourceDiscovery: this.sourceDiscoveryCheck,
      destinationRpc: { outcome: 'UNKNOWN' },
      chainInfo: this.chainInfoCheck,
      proofService: { outcome: 'UNKNOWN', message: 'proof service probe pending' },
      workerLoop: { outcome: workerObserved ? 'PASS' : 'UNKNOWN', running: workerObserved, lastLoopAt: this.lastLoopAt ?? heartbeat?.at ?? null },
    };
    if (persistence.message) result.persistence.message = safeError(persistence.message);
    const sourceRpcCheck: Promise<ConfigurationCheck> = boundedProbe(this.sourceProvider.getNetwork(), 'source RPC network')
      .then((network) => Number(network.chainId) === this.config.sourceChainId ? { outcome: 'PASS' as const } : { outcome: 'FAIL' as const, message: 'source chain ID mismatch' })
      .catch((error) => ({ outcome: 'UNKNOWN' as const, message: safeError(error) }));
    const destinationRpcCheck: Promise<ConfigurationCheck> = boundedProbe(this.destinationProvider.getNetwork(), 'destination RPC network')
      .then((network) => Number(network.chainId) === this.config.destinationChainId ? { outcome: 'PASS' as const } : { outcome: 'FAIL' as const, message: 'destination chain ID mismatch' })
      .catch((error) => ({ outcome: 'UNKNOWN' as const, message: safeError(error) }));
    const chainInfoCheck: Promise<ConfigurationCheck> = boundedProbe((async () => {
      const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(this.destinationProvider as any, this.config.expectedChainInfo);
      return chainInfoProvider.getSupportedChains();
    })(), 'ChainInfo')
      .then((supported) => {
      const source = (supported as any[]).find((entry) => Number(entry.chainKey) === this.config.sourceChainKey);
      return source && Number(source.chainId) === this.config.sourceChainId
        ? { outcome: 'PASS' as const }
        : { outcome: 'FAIL' as const, message: 'ChainInfo does not map configured chain key to Sepolia' };
      })
      .catch((error) => ({ outcome: 'UNKNOWN' as const, message: safeError(error) }));
    const proofServiceCheck: Promise<ConfigurationCheck> = fetch(this.config.proverUrl, { signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS) })
      .then((response) => response.ok ? { outcome: 'PASS' as const } : { outcome: 'UNKNOWN' as const, message: `proof service returned HTTP ${response.status}` })
      .catch((error) => ({ outcome: 'UNKNOWN' as const, message: safeError(error) }));
    const [sourceRpc, destinationRpc, chainInfoResult, proofService] = await Promise.all([sourceRpcCheck, destinationRpcCheck, chainInfoCheck, proofServiceCheck]);
    result.sourceRpc = sourceRpc;
    result.destinationRpc = destinationRpc;
    result.chainInfo = chainInfoResult;
    result.proofService = proofService;
    return result;
  }
}

export { asPolicy, classifyError, safeError, validProofShape, REGISTRY_ABI, VAULT_ABI, ASC_ABI, BLOCK_PROVER, CHAIN_INFO };
