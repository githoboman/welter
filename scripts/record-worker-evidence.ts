import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { AbiCoder, Contract, Interface, JsonRpcProvider, keccak256 } from 'ethers';
import { rpsMatchFinalizedAdapter } from '../src/adapter.js';
import { envelope } from '../src/api.js';
import { loadDeploymentManifest } from '../src/deployment.js';
import { DurableStore } from '../src/durable-store.js';
import { asPolicy, loadWorkerConfig } from '../src/worker-runtime.js';
import { normalizeHex, type WorkerJob } from '../src/worker-types.js';

const root = process.cwd();
const loadEnv = (): void => {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
};
loadEnv();

const [dataDirectoryArg, jobId, replayHashArg] = process.argv.slice(2);
if (!dataDirectoryArg || !jobId || !/^0x[0-9a-fA-F]{64}$/.test(replayHashArg ?? '')) {
  throw new Error('usage: npm run worker:evidence -- <data-directory> <job-id> <replay-transaction-hash>');
}

const artifact = (name: string): any => JSON.parse(fs.readFileSync(path.join(root, 'artifacts', `${name}.json`), 'utf8'));
const dataDirectory = path.resolve(root, dataDirectoryArg);
process.env.PRIZERAIL_DATA_DIR = dataDirectory;
const config = loadWorkerConfig(root);
const { manifest, file: deploymentFile } = loadDeploymentManifest(root);
const store = await DurableStore.open(dataDirectory, config.sourceStartBlock);
await store.refresh();
const originalJob = store.getJob(jobId);
if (!originalJob) throw new Error(`worker job not found: ${jobId}`);
const evidenceLeaseOwner = `evidence:${process.pid}:${Date.now()}`;

const sourceProvider = new JsonRpcProvider(config.sourceRpc);
const destinationProvider = new JsonRpcProvider(config.destinationRpc);
const registry = new Contract(config.sourceRegistry, artifact('TournamentResultRegistry').abi, sourceProvider);
const vault = new Contract(config.vault, artifact('PrizeVault').abi, destinationProvider);
const token = new Contract(config.token, artifact('MockPrizeToken').abi, destinationProvider);
const asc = new Contract(config.asc, artifact('PrizeRailASC').abi, destinationProvider);
const replayHash = normalizeHex(replayHashArg!);

const requireReceipt = async (provider: JsonRpcProvider, hash: string, label: string, expectedStatus: number): Promise<any> => {
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt) throw new Error(`${label} receipt is unavailable`);
  if (Number(receipt.status) !== expectedStatus) throw new Error(`${label} receipt status ${receipt.status} does not equal ${expectedStatus}`);
  return receipt;
};

const receiptEvent = (receipt: any, iface: Interface, name: string, address: string): any => {
  for (const log of receipt.logs ?? []) {
    if (normalizeHex(String(log.address)) !== normalizeHex(address)) continue;
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === name) return parsed;
    } catch {
      // Ignore unrelated logs in a multi-contract receipt.
    }
  }
  throw new Error(`${name} event is missing from ${receipt.hash}`);
};

const blockTimestamp = async (provider: JsonRpcProvider, blockNumber: number): Promise<number | null> => {
  const block = await provider.getBlock(blockNumber);
  return block ? Number(block.timestamp) : null;
};

const txEvidence = async (provider: JsonRpcProvider, receipt: any): Promise<Record<string, unknown>> => ({
  hash: normalizeHex(receipt.hash),
  status: Number(receipt.status),
  blockNumber: receipt.blockNumber,
  blockHash: normalizeHex(receipt.blockHash),
  gasUsed: receipt.gasUsed.toString(),
  blockTimestamp: await blockTimestamp(provider, receipt.blockNumber),
});

async function boundedEventLogs(provider: JsonRpcProvider, address: string, iface: Interface, eventName: string, from: number, to: number, predicate: (parsed: any) => boolean): Promise<any[]> {
  const records: any[] = [];
  for (let start = from; start <= to; start += 9) {
    const end = Math.min(to, start + 8);
    const logs = await provider.getLogs({ address, fromBlock: start, toBlock: end });
    for (const log of logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === eventName && predicate(parsed)) records.push(log);
      } catch {
        // Ignore events from other contracts or ABI entries.
      }
    }
  }
  return records;
}

const sourceReceipt = await requireReceipt(sourceProvider, originalJob.sourceTransactionHash, 'source', 1);
if (normalizeHex(String(sourceReceipt.to)) !== config.sourceRegistry) throw new Error('source receipt target is not the selected registry');
if (Number(sourceReceipt.blockNumber) !== originalJob.sourceBlockNumber) throw new Error('source receipt block does not match the durable job');
const decoded = rpsMatchFinalizedAdapter.decode(sourceReceipt, config.sourceRegistry);
const sameUint = (actual: unknown, expected: unknown): boolean => {
  try { return BigInt(String(actual)) === BigInt(String(expected)); } catch { return false; }
};
if (normalizeHex(decoded.tournamentId) !== normalizeHex(originalJob.tournamentId)
  || normalizeHex(decoded.matchId) !== normalizeHex(originalJob.matchId)
  || normalizeHex(decoded.playerOne) !== normalizeHex(originalJob.playerOne)
  || normalizeHex(decoded.playerTwo) !== normalizeHex(originalJob.playerTwo)
  || normalizeHex(decoded.winner) !== normalizeHex(originalJob.winner)
  || decoded.result !== originalJob.result
  || normalizeHex(decoded.rulesHash) !== normalizeHex(originalJob.rulesHash)
  || !sameUint(decoded.resultNonce, originalJob.resultNonce)
  || decoded.finalizationStatus !== originalJob.finalizationStatus
  || !sameUint(decoded.sourceChainId, originalJob.sourceChainId)
  || !sameUint(decoded.finalizedAt, originalJob.sourceFinalizedAt)
  || !sameUint(decoded.deadline, originalJob.sourceDeadline)) {
  throw new Error('source event predicates do not match the durable job');
}
if (!sameUint(decoded.sourceChainId, config.sourceChainId)) throw new Error('source event chain ID does not match the selected network');
const sourceStatus = Number(decoded.finalizationStatus);
const sourceResult = Number(decoded.result);
if (![0, 1].includes(sourceStatus)
  || (sourceStatus === 0 && ![0, 1, 2].includes(sourceResult))
  || (sourceStatus === 1 && ![0, 3, 4].includes(sourceResult))) {
  throw new Error('source event finalization predicates are invalid');
}
const zeroAddress = '0x0000000000000000000000000000000000000000';
if (normalizeHex(decoded.playerOne) === zeroAddress || normalizeHex(decoded.playerTwo) === zeroAddress || normalizeHex(decoded.playerOne) === normalizeHex(decoded.playerTwo)) throw new Error('source event player predicates are invalid');
const expectedWinner = sourceResult === 0 ? zeroAddress : [1, 3].includes(sourceResult) ? normalizeHex(decoded.playerOne) : normalizeHex(decoded.playerTwo);
if (normalizeHex(decoded.winner) !== expectedWinner) throw new Error('source event winner predicate is invalid');
if (sourceStatus === 1) {
  if (BigInt(String(decoded.finalizedAt)) <= BigInt(String(decoded.deadline))) throw new Error('timeout source result was finalized before its deadline');
}
if (!/^0x[0-9a-fA-F]{64}$/.test(String(originalJob.proofDigest ?? ''))
  || originalJob.proofPreflightOutcome !== 'PASS'
  || originalJob.proofHeader !== originalJob.sourceBlockNumber) {
  throw new Error('worker job lacks a successful proof bound to the source block');
}

if (!originalJob.settlementTransactionHash || !originalJob.payoutTransactionHash) throw new Error('worker job lacks settlement or payout transaction identity');
const settlementReceipt = await requireReceipt(destinationProvider, originalJob.settlementTransactionHash, 'settlement', 1);
const payoutReceipt = await requireReceipt(destinationProvider, originalJob.payoutTransactionHash, 'payout', 1);
const replayReceipt = await requireReceipt(destinationProvider, replayHash, 'replay', 0);
if (normalizeHex(String(settlementReceipt.to)) !== config.asc) throw new Error('settlement receipt target is not the selected ASC');
if (normalizeHex(String(payoutReceipt.to)) !== config.vault) throw new Error('payout receipt target is not the selected vault');
if (normalizeHex(String(replayReceipt.to)) !== config.asc) throw new Error('replay receipt target is not the selected ASC');

const registryInterface = new Interface(artifact('TournamentResultRegistry').abi);
const vaultInterface = new Interface(artifact('PrizeVault').abi);
const ascInterface = new Interface(artifact('PrizeRailASC').abi);
const resultVerified = receiptEvent(settlementReceipt, ascInterface, 'ResultVerified', config.asc);
const tournamentSettled = receiptEvent(settlementReceipt, vaultInterface, 'TournamentSettled', config.vault);
const prizeClaimed = receiptEvent(payoutReceipt, vaultInterface, 'PrizeClaimed', config.vault);
for (const event of [resultVerified, tournamentSettled, prizeClaimed]) {
  if (normalizeHex(String(event.args.tournamentId)) !== normalizeHex(originalJob.tournamentId)) throw new Error(`${event.name} tournament binding mismatch`);
}
if (normalizeHex(String(resultVerified.args.winner)) !== normalizeHex(originalJob.winner)
  || normalizeHex(String(tournamentSettled.args.winner)) !== normalizeHex(originalJob.winner)
  || normalizeHex(String(prizeClaimed.args.winner)) !== normalizeHex(originalJob.winner)) {
  throw new Error('settlement or payout winner binding mismatch');
}
if (!sameUint(resultVerified.args.resultNonce, originalJob.resultNonce)
  || !sameUint(tournamentSettled.args.resultNonce, originalJob.resultNonce)) {
  throw new Error('settlement event nonce binding mismatch');
}

// The journal can still contain a pending snapshot when a receipt was mined
// during a worker timeout.  The validated receipt is the authoritative source
// for settlement evidence written by this recorder.
const settlementBlockTimestamp = await blockTimestamp(destinationProvider, settlementReceipt.blockNumber);
const payoutBlockTimestamp = await blockTimestamp(destinationProvider, payoutReceipt.blockNumber);
const settlementTimestamp = settlementBlockTimestamp === null ? null : new Date(settlementBlockTimestamp * 1000).toISOString();
const payoutTimestamp = payoutBlockTimestamp === null ? null : new Date(payoutBlockTimestamp * 1000).toISOString();

const policy = asPolicy(await vault.policies(originalJob.tournamentId));
if (Number(policy.state) !== 3) throw new Error(`policy is not CLAIMED: ${policy.state}`);
if (normalizeHex(String(policy.organizer)) === zeroAddress) throw new Error('claimed policy has no organizer');
if (!Number.isSafeInteger(Number(policy.sourceChainKey)) || Number(policy.sourceChainKey) !== originalJob.sourceChainKey) throw new Error('claimed policy source chain key does not match source result');
if (normalizeHex(String(policy.sourceRegistry)) !== normalizeHex(config.sourceRegistry) || normalizeHex(String(policy.sourceRegistry)) !== normalizeHex(originalJob.sourceRegistry)) throw new Error('claimed policy source registry does not match source result');
if (normalizeHex(String(policy.rulesHash)) !== normalizeHex(originalJob.rulesHash)) throw new Error('claimed policy rules hash does not match source result');
if (normalizeHex(String(policy.token)) !== normalizeHex(config.token)) throw new Error('claimed policy token does not match selected deployment');
if (normalizeHex(String(policy.winner)) !== normalizeHex(originalJob.winner)) throw new Error('claimed policy winner does not match source winner');
if (!sameUint(policy.resultNonce, originalJob.resultNonce)) throw new Error('claimed policy nonce does not match source result');
let policyAmount: bigint;
try { policyAmount = BigInt(String(policy.amount)); } catch { throw new Error('claimed policy amount is not an integer'); }
if (policyAmount <= 0n || !sameUint(policy.amount, prizeClaimed.args.amount)) throw new Error('PrizeClaimed amount does not match policy amount');
const policyQueryKey = normalizeHex(String(policy.sourceQueryKey));
if (!/^0x[0-9a-f]{64}$/.test(policyQueryKey) || /^0x0+$/.test(policyQueryKey)) throw new Error('claimed policy source query key is invalid');
if (normalizeHex(String(originalJob.proofDigest)) !== policyQueryKey) throw new Error('claimed policy query key does not match the recorded proof digest');
const expectedBusinessKey = normalizeHex(keccak256(AbiCoder.defaultAbiCoder().encode(
  ['uint64', 'address', 'bytes32', 'uint256'],
  [originalJob.sourceChainKey, config.sourceRegistry, originalJob.tournamentId, originalJob.resultNonce],
)));
const resultVerifiedQueryKey = normalizeHex(String(resultVerified.args.sourceQueryKey));
const tournamentSettledQueryKey = normalizeHex(String(tournamentSettled.args.sourceQueryKey));
if (!/^0x[0-9a-f]{64}$/.test(resultVerifiedQueryKey)
  || /^0x0+$/.test(resultVerifiedQueryKey)
  || resultVerifiedQueryKey !== policyQueryKey
  || tournamentSettledQueryKey !== policyQueryKey) {
  throw new Error('settlement source query key is not consistently bound to policy and proof');
}
if (normalizeHex(String(resultVerified.args.businessKey)) !== expectedBusinessKey) throw new Error('ResultVerified business key does not match the source result');
if (normalizeHex(String(tournamentSettled.args.winner)) !== normalizeHex(String(policy.winner))) throw new Error('TournamentSettled winner does not match policy');

const sourceCreationFrom = Math.max(config.sourceDeploymentBlock, originalJob.sourceBlockNumber - 32);
// The source event and destination funding are submitted independently; keep
// a bounded but generous lookback for the fresh policy transactions while
// staying within public-provider log-range limits.
const destinationCreationFrom = Math.max(config.destinationDeploymentBlock, settlementReceipt.blockNumber - 100);
const createdLogs = await boundedEventLogs(destinationProvider, config.vault, vaultInterface, 'TournamentCreated', destinationCreationFrom, settlementReceipt.blockNumber, (event) => normalizeHex(String(event.args.tournamentId)) === originalJob.tournamentId);
const fundedLogs = await boundedEventLogs(destinationProvider, config.vault, vaultInterface, 'TournamentFunded', destinationCreationFrom, settlementReceipt.blockNumber, (event) => normalizeHex(String(event.args.tournamentId)) === originalJob.tournamentId);
const matchLogs = await boundedEventLogs(sourceProvider, config.sourceRegistry, registryInterface, 'MatchCreated', sourceCreationFrom, originalJob.sourceBlockNumber, (event) => normalizeHex(String(event.args.tournamentId)) === originalJob.tournamentId && normalizeHex(String(event.args.matchId)) === originalJob.matchId);
if (createdLogs.length !== 1 || fundedLogs.length !== 1 || matchLogs.length !== 1) throw new Error(`fresh policy/match creation evidence is incomplete or duplicated (created=${createdLogs.length}, funded=${fundedLogs.length}, match=${matchLogs.length}, destinationFrom=${destinationCreationFrom}, sourceFrom=${sourceCreationFrom})`);
const createdReceipt = await createdLogs[0].getTransactionReceipt();
const fundedReceipt = await fundedLogs[0].getTransactionReceipt();
const matchReceipt = await matchLogs[0].getTransactionReceipt();
if (normalizeHex(String(createdReceipt.to)) !== normalizeHex(config.vault) || normalizeHex(String(fundedReceipt.to)) !== normalizeHex(config.vault)) throw new Error('policy creation/funding receipt target mismatch');
if (normalizeHex(String(matchReceipt.to)) !== normalizeHex(config.sourceRegistry)) throw new Error('source match creation receipt target mismatch');
const createdEvent = receiptEvent(createdReceipt, vaultInterface, 'TournamentCreated', config.vault);
const fundedEvent = receiptEvent(fundedReceipt, vaultInterface, 'TournamentFunded', config.vault);
const matchEvent = receiptEvent(matchReceipt, registryInterface, 'MatchCreated', config.sourceRegistry);
if (normalizeHex(String(createdEvent.args.tournamentId)) !== normalizeHex(originalJob.tournamentId)
  || normalizeHex(String(createdEvent.args.organizer)) !== normalizeHex(String(policy.organizer))
  || normalizeHex(String(createdEvent.args.sourceRegistry)) !== normalizeHex(String(policy.sourceRegistry))
  || normalizeHex(String(createdEvent.args.rulesHash)) !== normalizeHex(String(policy.rulesHash))
  || !sameUint(createdEvent.args.amount, policy.amount)) {
  throw new Error('TournamentCreated predicates do not match the claimed policy');
}
if (normalizeHex(String(fundedEvent.args.tournamentId)) !== normalizeHex(originalJob.tournamentId)
  || !sameUint(fundedEvent.args.amount, policy.amount)) {
  throw new Error('TournamentFunded predicates do not match the claimed policy');
}
if (normalizeHex(String(matchEvent.args.tournamentId)) !== normalizeHex(originalJob.tournamentId)
  || normalizeHex(String(matchEvent.args.matchId)) !== normalizeHex(originalJob.matchId)
  || normalizeHex(String(matchEvent.args.playerOne)) !== normalizeHex(originalJob.playerOne)
  || normalizeHex(String(matchEvent.args.playerTwo)) !== normalizeHex(originalJob.playerTwo)
  || normalizeHex(String(matchEvent.args.rulesHash)) !== normalizeHex(originalJob.rulesHash)
  || !sameUint(matchEvent.args.revealDeadline, originalJob.sourceDeadline)) {
  throw new Error('MatchCreated predicates do not match the source result');
}

const journalRecords = fs.readFileSync(store.journalPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const jobSnapshots = journalRecords.filter((record) => record.op === 'job' && record.job?.jobId === jobId).map((record) => record.job as WorkerJob);
const proofAttempts = [...new Set(jobSnapshots.filter((job) => job.state === 'AWAITING_ATTESTATION').map((job) => job.attemptCount))].sort((a, b) => a - b);
const workerRuntimeCount = new Set(journalRecords.filter((record) => record.op === 'heartbeat').map((record) => record.heartbeat?.owner).filter(Boolean)).size;
const settlementHashes = [...new Set(jobSnapshots.map((job) => job.settlementTransactionHash).filter(Boolean))];
const payoutHashes = [...new Set(jobSnapshots.map((job) => job.payoutTransactionHash).filter(Boolean))];
const restartDemonstrated = workerRuntimeCount >= 2 && proofAttempts.includes(1) && proofAttempts.some((attempt) => attempt >= 2);
if (!restartDemonstrated) throw new Error('journal does not prove restart from an in-flight proof job');
if (settlementHashes.length !== 1 || payoutHashes.length !== 1) throw new Error('journal contains duplicate settlement or payout transaction identities');

const recordedAt = new Date().toISOString();
const evidenceFile = `worker-live-${recordedAt.replace(/[:.]/g, '-')}-${process.pid}-${randomBytes(8).toString('hex')}.json`;
const evidencePath = path.join(root, 'evidence', evidenceFile);
const evidenceReference = path.relative(root, evidencePath);
// The run identity is part of the evidence payload, so it must carry the
// same collision-resistant suffix as the exclusively published filename.
// Re-recording one durable job is a distinct evidence artifact, not a rewrite
// of the old run identity.
const evidenceRunId = evidenceFile.slice(0, -'.json'.length);
const replayEvidence = {
  rejected: true,
  outcome: 'PASS',
  hash: replayHash,
  status: 0,
  blockNumber: replayReceipt.blockNumber,
  gasUsed: replayReceipt.gasUsed.toString(),
  detectedAt: recordedAt,
};
const finalJob: WorkerJob = {
  ...originalJob,
  state: 'CLAIMED',
  productState: 'CLAIMED',
  outcome: 'PASS',
  evidenceOutcome: 'PASS',
  settlementTransactionHash: normalizeHex(settlementReceipt.hash),
  settlementReceiptStatus: 1,
  settlementBlock: settlementReceipt.blockNumber,
  settlementGas: settlementReceipt.gasUsed.toString(),
  settlementTimestamp,
  resultVerified: true,
  tournamentSettled: true,
  payoutTransactionHash: normalizeHex(payoutReceipt.hash),
  payoutReceiptStatus: 1,
  payoutBlock: payoutReceipt.blockNumber,
  payoutGas: payoutReceipt.gasUsed.toString(),
  payoutTimestamp,
  prizeClaimed: true,
  submissionUncertainty: false,
  replayEvidence,
  policy,
  policyState: 3,
  explorerLinks: { ...originalJob.explorerLinks, settlement: `${config.destinationExplorer}/tx/${normalizeHex(settlementReceipt.hash)}`, payout: `${config.destinationExplorer}/tx/${normalizeHex(payoutReceipt.hash)}`, replay: `${config.destinationExplorer}/tx/${replayHash}` },
  evidenceReferences: [...new Set([...originalJob.evidenceReferences, evidenceReference])],
  lastErrorClass: null,
  lastErrorMessage: null,
  nextRetryAt: null,
  lease: null,
  updatedAt: recordedAt,
};

const sourceTx = await txEvidence(sourceProvider, sourceReceipt);
const settlementTx = await txEvidence(destinationProvider, settlementReceipt);
const payoutTx = await txEvidence(destinationProvider, payoutReceipt);
const replayTx = await txEvidence(destinationProvider, replayReceipt);
const sourceTimestamp = Number(sourceTx.blockTimestamp);
const settlementTimestampSeconds = Number(settlementTx.blockTimestamp);
const lifecycle = store.getTransitions(jobId);
const evidence = {
  schemaVersion: 1,
  runId: evidenceRunId,
  mode: 'live-worker',
  dataMode: 'LIVE',
  outcome: 'PASS',
  deployment: { selector: 'evidence/current-deployment.json', manifest: path.relative(root, deploymentFile), protocolVersion: manifest.protocolVersion },
  source: {
    chainId: config.sourceChainId,
    chainKey: config.sourceChainKey,
    registry: config.sourceRegistry,
    transaction: sourceTx,
    decoded: {
      tournamentId: normalizeHex(decoded.tournamentId), matchId: normalizeHex(decoded.matchId), playerOne: normalizeHex(decoded.playerOne), playerTwo: normalizeHex(decoded.playerTwo), winner: normalizeHex(decoded.winner), result: decoded.result, rulesHash: normalizeHex(decoded.rulesHash), resultNonce: String(decoded.resultNonce), finalizationStatus: decoded.finalizationStatus, sourceChainId: String(decoded.sourceChainId), finalizedAt: String(decoded.finalizedAt), deadline: String(decoded.deadline),
    },
    creation: await txEvidence(sourceProvider, matchReceipt),
  },
  attestation: { proofIdentifier: finalJob.proofDigest, headerNumber: finalJob.proofHeader, cached: finalJob.proofCached, verified: finalJob.proofPreflightOutcome === 'PASS', latencyMs: finalJob.proofLatencyMs, rawProofPersisted: false },
  destination: {
    chainId: config.destinationChainId,
    token: config.token,
    vault: config.vault,
    asc: config.asc,
    amount: String(policy.amount),
    funding: { created: await txEvidence(destinationProvider, createdReceipt), funded: await txEvidence(destinationProvider, fundedReceipt) },
    settlement: settlementTx,
    payout: payoutTx,
    finalState: 3,
    winnerBalance: String(await token.balanceOf(originalJob.winner)),
    events: { resultVerified: true, tournamentSettled: true, prizeClaimed: true },
  },
  worker: {
    jobId,
    dataDirectory: path.relative(root, dataDirectory),
    automaticClaim: config.autoClaim,
    finalState: finalJob.state,
    attempts: finalJob.attemptCount,
    retries: finalJob.retryCount,
    restart: { demonstrated: restartDemonstrated, stateBeforeRestart: 'AWAITING_ATTESTATION', proofAttempts, distinctRuntimeCount: workerRuntimeCount },
    idempotency: { sourceIdentity: `${finalJob.sourceChainId}:${finalJob.sourceTransactionHash}`, businessIdentity: `${finalJob.tournamentId}:${finalJob.resultNonce}`, settlementTransactionCount: settlementHashes.length, payoutTransactionCount: payoutHashes.length },
    lifecycle,
  },
  replay: replayEvidence,
  apiFinal: envelope(finalJob, policy, config, lifecycle as unknown as Array<Record<string, unknown>>),
  timing: { sourceBlockTimestamp: sourceTimestamp, settlementBlockTimestamp: settlementTimestampSeconds, sourceToSettlementSeconds: settlementTimestampSeconds - sourceTimestamp, recordedAt },
  explorers: { source: `${config.sourceExplorer}/tx/${finalJob.sourceTransactionHash}`, settlement: `${config.destinationExplorer}/tx/${finalJob.settlementTransactionHash}`, payout: `${config.destinationExplorer}/tx/${finalJob.payoutTransactionHash}`, replay: `${config.destinationExplorer}/tx/${replayHash}` },
  limitations: ['testnet-only', 'single-host append-only journal', 'hosted prover and public RPC availability', 'role reuse between funded testnet wallets'],
};

// Materializing evidence also updates the durable projection.  Fence that
// write so an operator cannot overwrite a worker's newer settlement/payout
// progress while the evidence command is running.
const leasedJob = await store.claimLease(jobId, evidenceLeaseOwner, Math.max(config.leaseTtlMs, 60_000));
if (!leasedJob) throw new Error('worker job is currently leased; retry evidence recording after the active worker releases it');
try {
  if (normalizeHex(leasedJob.sourceTransactionHash) !== normalizeHex(originalJob.sourceTransactionHash)
    || leasedJob.sourceChainId !== originalJob.sourceChainId
    || leasedJob.sourceChainKey !== originalJob.sourceChainKey
    || normalizeHex(leasedJob.sourceRegistry) !== normalizeHex(originalJob.sourceRegistry)
    || normalizeHex(leasedJob.matchId) !== normalizeHex(originalJob.matchId)
    || normalizeHex(leasedJob.rulesHash) !== normalizeHex(originalJob.rulesHash)
    || normalizeHex(leasedJob.winner) !== normalizeHex(originalJob.winner)
    || leasedJob.result !== originalJob.result
    || normalizeHex(leasedJob.tournamentId) !== normalizeHex(originalJob.tournamentId)
    || leasedJob.resultNonce !== originalJob.resultNonce
    || (leasedJob.settlementTransactionHash && originalJob.settlementTransactionHash
      ? normalizeHex(leasedJob.settlementTransactionHash) !== normalizeHex(originalJob.settlementTransactionHash)
      : leasedJob.settlementTransactionHash !== originalJob.settlementTransactionHash)
    || (leasedJob.payoutTransactionHash && originalJob.payoutTransactionHash
      ? normalizeHex(leasedJob.payoutTransactionHash) !== normalizeHex(originalJob.payoutTransactionHash)
      : leasedJob.payoutTransactionHash !== originalJob.payoutTransactionHash)) {
    throw new Error('worker job changed while evidence was being validated; refusing to overwrite newer progress');
  }
  // Keep the latest journal metadata (attempts, retries, proof identifiers,
  // and diagnostic context) while applying only receipt-validated terminal
  // fields from this evidence run.
  const materializedJob: WorkerJob = {
    ...leasedJob,
    state: finalJob.state,
    productState: finalJob.productState,
    outcome: finalJob.outcome,
    evidenceOutcome: finalJob.evidenceOutcome,
    submissionUncertainty: false,
    settlementTransactionHash: finalJob.settlementTransactionHash,
    settlementReceiptStatus: finalJob.settlementReceiptStatus,
    settlementBlock: finalJob.settlementBlock,
    settlementGas: finalJob.settlementGas,
    settlementTimestamp: finalJob.settlementTimestamp,
    resultVerified: finalJob.resultVerified,
    tournamentSettled: finalJob.tournamentSettled,
    payoutTransactionHash: finalJob.payoutTransactionHash,
    payoutReceiptStatus: finalJob.payoutReceiptStatus,
    payoutBlock: finalJob.payoutBlock,
    payoutGas: finalJob.payoutGas,
    payoutTimestamp: finalJob.payoutTimestamp,
    prizeClaimed: finalJob.prizeClaimed,
    replayEvidence: finalJob.replayEvidence,
    refundRecoveryEvidence: finalJob.refundRecoveryEvidence,
    policy: finalJob.policy,
    policyState: finalJob.policyState,
    explorerLinks: {
      ...leasedJob.explorerLinks,
      settlement: finalJob.explorerLinks.settlement,
      payout: finalJob.explorerLinks.payout,
      replay: finalJob.explorerLinks.replay,
    },
    evidenceReferences: [...new Set([...leasedJob.evidenceReferences, evidenceReference])],
    lastErrorClass: null,
    lastErrorMessage: null,
    nextRetryAt: null,
    lease: leasedJob.lease,
    updatedAt: finalJob.updatedAt,
  };

  const evidenceDocument = {
    ...evidence,
    attestation: {
      ...evidence.attestation,
      proofIdentifier: materializedJob.proofDigest,
      headerNumber: materializedJob.proofHeader,
      cached: materializedJob.proofCached,
      verified: materializedJob.proofPreflightOutcome === 'PASS',
      latencyMs: materializedJob.proofLatencyMs,
    },
    worker: {
      ...evidence.worker,
      finalState: materializedJob.state,
      attempts: materializedJob.attemptCount,
      retries: materializedJob.retryCount,
    },
    apiFinal: envelope(materializedJob, policy, config, lifecycle as unknown as Array<Record<string, unknown>>),
    explorers: {
      ...evidence.explorers,
      source: `${config.sourceExplorer}/tx/${materializedJob.sourceTransactionHash}`,
      settlement: `${config.destinationExplorer}/tx/${materializedJob.settlementTransactionHash}`,
      payout: `${config.destinationExplorer}/tx/${materializedJob.payoutTransactionHash}`,
    },
  };
  const serialized = `${JSON.stringify(evidenceDocument, null, 2)}\n`;
  if (/PRIVATE_KEY|SESSION_SECRET|DATABASE_URL|txBytes|merkleProof|continuityProof/.test(serialized)) throw new Error('evidence contains forbidden secret or raw-proof fields');
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const temporaryPath = `${evidencePath}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
  fs.writeFileSync(temporaryPath, serialized, { mode: 0o600, flag: 'wx' });
  try {
    // Hard-linking is exclusive on the destination path, unlike renameSync,
    // which would silently replace an existing historical artifact.
    fs.linkSync(temporaryPath, evidencePath);
  } finally {
    fs.unlinkSync(temporaryPath);
  }
  await store.saveJob(materializedJob, 'worker live evidence recorded', evidenceLeaseOwner);
} finally {
  await store.releaseLease(jobId, evidenceLeaseOwner).catch(() => undefined);
}
sourceProvider.destroy();
destinationProvider.destroy();
console.log(JSON.stringify({ evidence: evidenceReference, jobId, source: finalJob.sourceTransactionHash, settlement: finalJob.settlementTransactionHash, payout: finalJob.payoutTransactionHash, replay: replayHash, restartDemonstrated, outcome: 'PASS' }, null, 2));
