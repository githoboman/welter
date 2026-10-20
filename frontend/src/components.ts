import { PUBLIC_CONFIG } from './config.js';
import type {
  ApiHealthResponse,
  DataMode,
  DataResult,
  EvidenceOutcome,
  FlowStage,
  HistoricalRunEvidence,
  LiveResponse,
  PolicyState,
  ProductState,
  RecoveryEvidence,
  WalletSnapshot,
} from './domain.js';
import type { LaunchDraft, LaunchState } from './transactions.js';

export const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

export function formatHash(value: string, visible = 8): string {
  if (!value || value.length <= visible * 2 + 3) return value;
  return `${value.slice(0, visible)}…${value.slice(-visible)}`;
}

export function formatAddress(value: string): string {
  return formatHash(value, 6);
}

export function formatAmount(value: string): string {
  try {
    const amount = BigInt(value);
    const whole = amount / 1_000_000_000_000_000_000n;
    const fraction = amount % 1_000_000_000_000_000_000n;
    if (fraction === 0n) return `${whole.toString()} PRIZE`;
    return `${Number(amount) / 1e18} PRIZE`;
  } catch {
    return 'UNKNOWN PRIZE amount';
  }
}

export function formatDate(value: string | number): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'UNKNOWN timestamp';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
    new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric),
  );
}

export function resultLabel(result: number): string {
  if (result === 1) return 'Player one wins';
  if (result === 2) return 'Player two wins';
  if (result === 3) return 'Draw · non-payable result';
  return 'Unknown source result';
}

export function modeBadge(mode: DataMode, compact = false): string {
  const labels: Record<DataMode, string> = {
    LIVE: 'LIVE',
    HISTORICAL_VERIFIED_RUN: 'HISTORICAL VERIFIED RUN',
    DEVELOPMENT_FIXTURE: 'DEVELOPMENT FIXTURE',
  };
  // Keep runtime data from becoming an HTML class even if a malformed API
  // response bypasses the compile-time DataMode union.
  const selected = Object.prototype.hasOwnProperty.call(labels, mode) ? mode : undefined;
  if (!selected) return '<span class="mode-badge mode-unknown" title="Data source mode">UNKNOWN DATA MODE</span>';
  const label = compact ? labels[selected].replace('HISTORICAL VERIFIED RUN', 'HISTORICAL') : labels[selected];
  return `<span class="mode-badge mode-${selected.toLowerCase()}" title="Data source mode">${escapeHtml(label)}</span>`;
}

export function outcomeBadge(outcome: EvidenceOutcome, label?: string): string {
  const outcomes: Record<EvidenceOutcome, true> = { PASS: true, FAIL: true, UNKNOWN: true };
  const selected = Object.prototype.hasOwnProperty.call(outcomes, outcome) ? outcome : 'UNKNOWN';
  const text = label ?? selected;
  return `<span class="outcome outcome-${selected.toLowerCase()}"><span class="outcome-dot" aria-hidden="true"></span>${escapeHtml(text)}</span>`;
}

export function statusBadge(state: ProductState | PolicyState, label?: string): string {
  const knownStates = new Set<string>([
    'DRAFT', 'FUNDED', 'CLAIMABLE', 'CLAIMED', 'REFUNDED',
    'MATCH_PENDING', 'MATCH_ACTIVE', 'MATCH_FINALIZED', 'MATCH_FINALIZATION_BLOCKED', 'MATCH_TIMEOUT_FINALIZABLE',
    'MINED', 'AWAITING_ATTESTATION', 'PROOF_READY', 'PROOF_PREFLIGHT_PASS', 'PROOF_PREFLIGHT_FAIL',
    'ATTESTATION_VERIFIED', 'SUBMITTING', 'SETTLEMENT_PENDING', 'SETTLEMENT_COMPLETE', 'PAYOUT_PENDING',
    'PAYOUT_COMPLETE', 'REFUND_AVAILABLE', 'RECOVERY_AVAILABLE', 'NON_PAYABLE_RESULT', 'VERIFICATION_FAILED',
    'REPLAY_REJECTED', 'ALREADY_SETTLED', 'INFRASTRUCTURE_UNAVAILABLE', 'UNKNOWN',
  ]);
  const selected = typeof state === 'string' && knownStates.has(state) ? state : 'UNKNOWN';
  const display = label ?? selected.replaceAll('_', ' ');
  const kind = selected.includes('FAIL') || selected.includes('REJECTED') ? 'fail' : selected.includes('UNKNOWN') || selected.includes('UNAVAILABLE') ? 'unknown' : selected.includes('COMPLETE') || selected === 'CLAIMED' || selected === 'CLAIMABLE' || selected === 'SETTLEMENT_COMPLETE' || selected === 'PAYOUT_COMPLETE' || selected === 'REFUNDED' ? 'pass' : 'progress';
  return `<span class="state-badge state-${kind}">${escapeHtml(display)}</span>`;
}

export function stateCatalog(): string {
  const states: Array<[ProductState | PolicyState, string]> = [
    ['DRAFT', 'Policy created, not funded'],
    ['FUNDED', 'Reserve held by the vault'],
    ['MATCH_PENDING', 'Source match has no meaningful progress'],
    ['MATCH_ACTIVE', 'Source match is still revealing'],
    ['MATCH_FINALIZED', 'Source result is frozen'],
    ['MATCH_FINALIZATION_BLOCKED', 'Finalization guard has not cleared'],
    ['MATCH_TIMEOUT_FINALIZABLE', 'Deadline passed; any caller may finalize'],
    ['MINED', 'Successful source receipt observed'],
    ['AWAITING_ATTESTATION', 'Hosted proof is still pending'],
    ['PROOF_READY', 'Proof payload returned'],
    ['PROOF_PREFLIGHT_PASS', 'Native preflight accepted'],
    ['PROOF_PREFLIGHT_FAIL', 'Proof or preflight failed'],
    ['ATTESTATION_VERIFIED', 'Attestcoin preflight accepted'],
    ['SUBMITTING', 'Settlement transaction sent'],
    ['SETTLEMENT_PENDING', 'Receipt/state reconciliation required'],
    ['SETTLEMENT_COMPLETE', 'Policy advanced to claimable'],
    ['CLAIMABLE', 'Winner can be paid by claimFor'],
    ['PAYOUT_PENDING', 'Claim receipt not yet observed'],
    ['PAYOUT_COMPLETE', 'Payout receipt and event observed'],
    ['CLAIMED', 'Winner payout completed'],
    ['REFUND_AVAILABLE', 'Organizer refund window is open'],
    ['RECOVERY_AVAILABLE', 'Permissionless recovery window is open'],
    ['REFUNDED', 'Reserve returned to organizer'],
    ['NON_PAYABLE_RESULT', 'Draw or unsupported result cannot settle'],
    ['VERIFICATION_FAILED', 'Semantic or proof predicate failed'],
    ['REPLAY_REJECTED', 'Consumed replay was rejected'],
    ['ALREADY_SETTLED', 'Settlement is already terminal or claimable'],
    ['INFRASTRUCTURE_UNAVAILABLE', 'RPC/prover response is unknown'],
    ['UNKNOWN', 'Evidence is missing or contradictory'],
  ];
  return `<div class="state-catalog">${states.map(([state, description]) => `<div><div>${statusBadge(state)}</div><p>${escapeHtml(description)}</p></div>`).join('')}</div>`;
}

export function copyButton(value: string, label = 'Copy value'): string {
  return `<button class="icon-button" type="button" data-copy="${escapeHtml(value)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">⧉</button>`;
}

function safeExplorerUrl(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    const allowedHosts = new Set([
      new URL(PUBLIC_CONFIG.sepoliaExplorer).hostname,
      new URL(PUBLIC_CONFIG.creditcoinExplorer).hostname,
    ]);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !allowedHosts.has(url.hostname.toLowerCase())) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function externalLink(href: string | undefined, label = 'Open explorer', className = 'external-link'): string {
  const safeHref = safeExplorerUrl(href);
  if (!safeHref) return '<span class="muted">Unavailable</span>';
  return `<a class="${escapeHtml(className)}" href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} ↗</a>`;
}

export function hashField(label: string, value: string | undefined, href?: string): string {
  if (!value) return `<div class="detail-row"><dt>${escapeHtml(label)}</dt><dd class="muted">UNKNOWN</dd></div>`;
  return `<div class="detail-row"><dt>${escapeHtml(label)}</dt><dd><span class="hash-value" title="${escapeHtml(value)}">${escapeHtml(formatHash(value))}</span>${copyButton(value, `Copy ${label}`)}${href ? externalLink(href) : ''}</dd></div>`;
}

export function detailRow(label: string, value: string, extra = ''): string {
  return `<div class="detail-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}${extra}</dd></div>`;
}

export function unavailableState(message: string, mode: DataMode = 'LIVE'): string {
  return `<div class="unavailable-state">${modeBadge(mode)}<div><strong>UNKNOWN</strong><p>${escapeHtml(message)}</p></div></div>`;
}

export function sectionHeading(eyebrow: string, title: string, copy?: string): string {
  return `<div class="section-heading"><p class="eyebrow">${escapeHtml(eyebrow)}</p><h2>${escapeHtml(title)}</h2>${copy ? `<p class="section-copy">${escapeHtml(copy)}</p>` : ''}</div>`;
}

export function flowStages(): FlowStage[] {
  return [
    { id: 'MATCH_FINALIZED', label: 'Source result', description: 'A game contract records the outcome.', authority: 'Sepolia registry', mode: 'DEVELOPMENT_FIXTURE' },
    { id: 'AWAITING_ATTESTATION', label: 'Attestcoin proof', description: 'Canonical inclusion is requested asynchronously.', authority: 'Attestcoin + hosted prover', mode: 'DEVELOPMENT_FIXTURE' },
    { id: 'PROOF_PREFLIGHT_PASS', label: 'Creditcoin verify', description: 'Native proof and semantic predicates are checked.', authority: 'PrizeRail ASC', mode: 'DEVELOPMENT_FIXTURE' },
    { id: 'SETTLEMENT_COMPLETE', label: 'Settlement', description: 'The funded policy becomes claimable.', authority: 'PrizeVault', mode: 'DEVELOPMENT_FIXTURE' },
    { id: 'CLAIMED', label: 'Winner payout', description: 'The frozen winner receives the test prize.', authority: 'Permissionless claimFor', mode: 'DEVELOPMENT_FIXTURE' },
  ];
}

export function flowStrip(active?: ProductState): string {
  const stages = flowStages();
  const activeIndex = active ? stages.findIndex((stage) => stage.id === active) : -1;
  return `<ol class="flow-strip" aria-label="PrizeRail workflow model">${stages.map((stage, index) => `<li class="flow-step ${active && index <= activeIndex ? 'is-complete' : ''} ${active === stage.id ? 'is-active' : ''}"><span class="flow-index">${index + 1}</span><div><strong>${escapeHtml(stage.label)}</strong><span>${escapeHtml(stage.description)}</span><small>${escapeHtml(stage.authority)} · workflow model</small></div></li>`).join('')}</ol>`;
}

export function limitationCallout(): string {
  return `<aside class="limitation-callout"><span class="callout-mark" aria-hidden="true">!</span><div><strong>What the proof means</strong><p>PrizeRail proves and settles the result recorded by the source game. Current scope is one source match per registered prize policy. It does not claim to detect off-chain cheating.</p></div></aside>`;
}

export function evidenceSummary(run: HistoricalRunEvidence): string {
  const source = run.source;
  const destination = run.destination;
  const payout = destination.payout;
  return `<div class="evidence-summary"><div class="summary-lead"><div><p class="eyebrow">Completed testnet run · ${escapeHtml(run.runId)}</p><h3>${escapeHtml(resultLabel(source.decoded.result))}</h3><p class="summary-copy">Recorded on Ethereum Sepolia, proven through Attestcoin, and settled on Creditcoin CC3.</p></div><div class="summary-state">${modeBadge('HISTORICAL_VERIFIED_RUN')} ${statusBadge('CLAIMED', 'CLAIMED')}</div></div><div class="summary-grid"><div><span class="summary-label">Prize</span><strong>${escapeHtml(formatAmount(destination.amount))}</strong><small>Test token · no monetary value</small></div><div><span class="summary-label">Source block</span><strong>${escapeHtml(String(source.transaction.blockNumber))}</strong><small>Sepolia · chain ID ${escapeHtml(String(source.chainId))}</small></div><div><span class="summary-label">Settlement</span><strong>CC3 #${escapeHtml(String(destination.settlement.blockNumber))}</strong><small>${escapeHtml(String(run.timing.sourceToSettlementSeconds))}s observed · no SLA</small></div><div><span class="summary-label">Replay</span><strong>${run.replay.rejected ? 'Rejected' : 'UNKNOWN'}</strong><small>Mined status ${escapeHtml(String(run.replay.status))}</small></div></div></div>`;
}

export function evidenceDetails(run: HistoricalRunEvidence): string {
  const decoded = run.source.decoded;
  const destination = run.destination;
  return `<div class="detail-stack"><section class="detail-section"><div class="detail-section-head"><div><p class="eyebrow">01 · Source result</p><h3>Recorded on Sepolia</h3></div>${outcomeBadge('PASS', 'PASS · receipt and event')}</div><dl class="detail-grid">${hashField('Source transaction', run.source.transaction.hash, run.explorers.source)}${detailRow('Source contract', formatAddress(run.source.registry), copyButton(run.source.registry, 'Copy source contract'))}${detailRow('Tournament ID', formatHash(decoded.tournamentId), copyButton(decoded.tournamentId, 'Copy tournament ID'))}${detailRow('Match ID', formatHash(decoded.matchId), copyButton(decoded.matchId, 'Copy match ID'))}${detailRow('Winner', formatAddress(decoded.winner), copyButton(decoded.winner, 'Copy winner address'))}${detailRow('Result', resultLabel(decoded.result))}${detailRow('Rules hash', formatHash(decoded.rulesHash), copyButton(decoded.rulesHash, 'Copy rules hash'))}${detailRow('Result nonce', formatHash(decoded.resultNonce), copyButton(decoded.resultNonce, 'Copy result nonce'))}${detailRow('Block / gas', `${run.source.transaction.blockNumber} / ${run.source.transaction.gasUsed}`)}${detailRow('Finalized', formatDate(decoded.finalizedAt))}</dl></section><section class="detail-section"><div class="detail-section-head"><div><p class="eyebrow">02 · Attestcoin</p><h3>Canonical history check</h3></div>${outcomeBadge(run.attestation.verified ? 'PASS' : 'UNKNOWN', run.attestation.verified ? 'PASS · preflight accepted' : 'UNKNOWN')}</div><dl class="detail-grid">${detailRow('Chain key', String(run.source.chainKey), ' <span class="detail-note">runtime mapping recorded</span>')}${detailRow('Proof header', String(run.attestation.headerNumber))}${hashField('Proof digest', run.attestation.proofIdentifier)}${detailRow('Cached', run.attestation.proofCached ? 'Yes' : 'No')}${detailRow('Observed latency', `${(run.attestation.latencyMs / 1000).toFixed(1)} seconds · observation only`)}</dl><p class="detail-note-block">Raw proof bytes are not present in the public bundle. The standard verifier treats this preflight result as recorded evidence; optional reconstruction may return UNKNOWN when the hosted prover is unavailable.</p></section><section class="detail-section"><div class="detail-section-head"><div><p class="eyebrow">03 · Creditcoin settlement</p><h3>Semantic predicates accepted</h3></div>${outcomeBadge('PASS', 'PASS · atomic settlement')}</div><dl class="detail-grid">${hashField('Settlement transaction', destination.settlement.hash, run.explorers.settlement)}${detailRow('ASC', formatAddress(destination.asc), copyButton(destination.asc, 'Copy ASC address'))}${detailRow('Vault', formatAddress(destination.vault), copyButton(destination.vault, 'Copy vault address'))}${detailRow('Policy state', 'CLAIMABLE → CLAIMED')}${detailRow('Block / gas', `${destination.settlement.blockNumber} / ${destination.settlement.gasUsed}`)}${detailRow('Checked fields', 'chain key · source · event · tournament · rules · winner · nonce · deadline')}</dl></section><section class="detail-section"><div class="detail-section-head"><div><p class="eyebrow">04 · Payout and replay</p><h3>Claim and negative-path evidence</h3></div>${outcomeBadge(run.replay.rejected ? 'PASS' : 'UNKNOWN', run.replay.rejected ? 'PASS · replay rejected' : 'UNKNOWN')}</div><dl class="detail-grid">${hashField('Payout transaction', destination.payout.hash, run.explorers.payout)}${detailRow('Payout amount', formatAmount(destination.amount))}${detailRow('Winner balance', formatAmount(destination.winnerBalance))}${hashField('Replay transaction', run.replay.hash, run.explorers.replay)}${detailRow('Replay receipt', `status ${run.replay.status} · ${run.replay.error}`)}${detailRow('Replay gas', run.replay.gasUsed)}</dl></section></div>`;
}

export function recoveryDetails(recovery: RecoveryEvidence): string {
  return `<section class="detail-section recovery-detail"><div class="detail-section-head"><div><p class="eyebrow">Archived recovery run</p><h3>Expired funded policy recovered safely</h3></div>${outcomeBadge(recovery.settlementBlockedByState ? 'PASS' : 'UNKNOWN', recovery.settlementBlockedByState ? 'PASS · state guard held' : 'UNKNOWN')}</div><dl class="detail-grid">${hashField('Recovery transaction', recovery.recovery.hash, recovery.explorers.recovery)}${detailRow('Tournament ID', formatHash(recovery.tournamentId), copyButton(recovery.tournamentId, 'Copy tournament ID'))}${detailRow('Terminal state', 'REFUNDED')}${detailRow('Trigger', formatAddress(recovery.trigger), copyButton(recovery.trigger, 'Copy trigger address'))}${detailRow('Beneficiary', `${formatAddress(recovery.organizer)} · immutable organizer`, copyButton(recovery.organizer, 'Copy organizer address'))}${detailRow('Organizer increase', formatAmount(recovery.recovery.organizerBalanceIncrease))}${detailRow('Block / gas', `${recovery.recovery.blockNumber} / ${recovery.recovery.gasUsed}`)}</dl><p class="detail-note-block">Recovery is permissionless after the refund deadline, but funds always go to the frozen organizer. This is historical evidence, not a live recovery action.</p></section>`;
}

export function deploymentFacts(): string {
  return `<dl class="detail-grid compact-grid">${detailRow('Network', `BOT Chain Testnet (Chain ID ${PUBLIC_CONFIG.botchainChainId})`)}${detailRow('Source registry', formatAddress(PUBLIC_CONFIG.sourceRegistry), copyButton(PUBLIC_CONFIG.sourceRegistry, 'Copy registry address'))}${detailRow('PrizeVault', formatAddress(PUBLIC_CONFIG.prizeVault), copyButton(PUBLIC_CONFIG.prizeVault, 'Copy vault address'))}${detailRow('BotChainSettler', formatAddress(PUBLIC_CONFIG.botchainSettler), copyButton(PUBLIC_CONFIG.botchainSettler, 'Copy settler address'))}${detailRow('Prize Token', `${formatAddress(PUBLIC_CONFIG.prizeToken)} · PRIZE test token`)}</dl>`;
}

export function transactionTimeline(run: HistoricalRunEvidence): string {
  const sourceStepLabels = [
    ['Match created', 'Sepolia source registry'],
    ['Commitment 1 recorded', 'Source match remains active'],
    ['Commitment 2 recorded', 'Both commitments now exist'],
    ['Reveal 1 recorded', 'Reveal guard cleared after both commitments'],
    ['Reveal 2 recorded', 'Source result became deterministic'],
  ] as const;
  const entries = [
    ...run.source.steps.map((tx, index) => ({ label: sourceStepLabels[index]?.[0] ?? `Source step ${index + 1}`, detail: sourceStepLabels[index]?.[1] ?? 'Sepolia source registry', tx, status: 'MINED' })),
    { label: 'Match finalized', detail: `${resultLabel(run.source.decoded.result)} · block ${run.source.transaction.blockNumber}`, tx: run.source.transaction, status: 'MINED' },
    { label: 'Attestcoin preflight', detail: `Header ${run.attestation.headerNumber} · ${run.attestation.verified ? 'accepted' : 'UNKNOWN'}`, tx: undefined, status: run.attestation.verified ? 'PROOF_PREFLIGHT_PASS' : 'UNKNOWN' },
    { label: 'Creditcoin settlement', detail: 'ResultVerified + TournamentSettled', tx: run.destination.settlement, status: 'SETTLEMENT_COMPLETE' },
    { label: 'Winner payout', detail: 'Permissionless claimFor · frozen winner', tx: run.destination.payout, status: 'CLAIMED' },
    { label: 'Replay attempt', detail: 'Mined rejection · no second payout', tx: { hash: run.replay.hash, blockNumber: run.replay.blockNumber, gasUsed: run.replay.gasUsed }, status: 'REPLAY_REJECTED' },
  ];
  return `<ol class="timeline">${entries.map((entry, index) => `<li class="timeline-item"><span class="timeline-marker">${index + 1}</span><div class="timeline-content"><div class="timeline-head"><strong>${escapeHtml(entry.label)}</strong>${statusBadge(entry.status as ProductState)}</div><p>${escapeHtml(entry.detail)}</p>${entry.tx ? `<div class="timeline-tx"><span>${escapeHtml(formatHash(entry.tx.hash))}</span>${copyButton(entry.tx.hash, `Copy ${entry.label} transaction`)}<span class="muted">block ${escapeHtml(String(entry.tx.blockNumber))}</span></div>` : '<span class="muted">Recorded in the evidence bundle; no transaction was sent for this step.</span>'}</div></li>`).join('')}</ol>`;
}

function liveRecordValue(record: Record<string, unknown> | null | undefined, key: string): unknown {
  return record ? record[key] : undefined;
}

function liveValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'UNKNOWN';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return 'UNKNOWN'; }
  }
  return String(value);
}

function liveRow(label: string, record: Record<string, unknown> | null | undefined, key: string, extra = ''): string {
  return detailRow(label, liveValue(liveRecordValue(record, key)), extra);
}

function liveHashRow(label: string, record: Record<string, unknown> | null | undefined, key: string, href?: string | null): string {
  const value = liveRecordValue(record, key);
  return typeof value === 'string' && value.length > 0 ? hashField(label, value, href ?? undefined) : detailRow(label, 'UNKNOWN');
}

function liveCopyButton(label: string, value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? copyButton(value, label) : '';
}

function liveErrorText(error: Record<string, unknown> | null | undefined): string {
  if (!error) return '';
  const errorClass = liveValue(error.class);
  const message = liveValue(error.message);
  return `${errorClass} · ${message}`;
}

function liveProgress(live: LiveResponse): string {
  const source = live.source;
  const attestcoin = live.attestcoin;
  const settlement = live.settlement;
  const payout = live.payout;
  const sourceMined = liveRecordValue(source, 'receiptStatus') === 1;
  const proofPass = liveRecordValue(attestcoin, 'preflight') === 'PASS';
  const verificationPass = liveRecordValue(settlement, 'receiptStatus') === 1
    && liveRecordValue(settlement, 'resultVerified') === true;
  const settlementPass = verificationPass && liveRecordValue(settlement, 'tournamentSettled') === true;
  const payoutPass = liveRecordValue(payout, 'receiptStatus') === 1 && liveRecordValue(payout, 'prizeClaimed') === true;
  const stages: Array<[string, string, EvidenceOutcome]> = [
    ['SOURCE RESULT', sourceMined ? 'MINED' : source ? 'UNKNOWN' : 'NOT OBSERVED', sourceMined ? 'PASS' : 'UNKNOWN'],
    ['ATTESTATION', proofPass ? 'PREFLIGHT PASS' : liveValue(liveRecordValue(attestcoin, 'proofStatus')).replaceAll('_', ' '), proofPass ? 'PASS' : 'UNKNOWN'],
    ['CREDITCOIN VERIFICATION', verificationPass ? 'RESULT VERIFIED' : 'NOT CONFIRMED', verificationPass ? 'PASS' : 'UNKNOWN'],
    ['SETTLEMENT', settlementPass ? 'TOURNAMENT SETTLED' : live.productState === 'SETTLEMENT_PENDING' ? 'PENDING' : 'NOT CONFIRMED', settlementPass ? 'PASS' : 'UNKNOWN'],
    ['PAYOUT', payoutPass ? 'CLAIMED' : live.policyState === 'CLAIMABLE' ? 'CLAIMABLE' : 'NOT CONFIRMED', payoutPass ? 'PASS' : 'UNKNOWN'],
  ];
  return `<ol class="live-progress" aria-label="Live settlement stages">${stages.map(([label, state, outcome], index) => `<li><span class="live-progress-index">${index + 1}</span><div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(state)}</span></div>${outcomeBadge(outcome)}</li>`).join('')}</ol>`;
}

export function liveSummary(live: LiveResponse): string {
  const source = live.source;
  const sourceId = liveRecordValue(source, 'tournamentId');
  const apiError = liveErrorText(live.error);
  return `<div class="live-summary"><div class="summary-lead"><div><p class="eyebrow">Live API response${live.jobId ? ` · ${escapeHtml(live.jobId)}` : ''}</p><h3>${escapeHtml(live.productState.replaceAll('_', ' '))}</h3><p class="summary-copy">This panel is read from the configured worker/API at render time. It is not historical evidence and it never sends a transaction.</p></div><div class="summary-state">${modeBadge('LIVE')} ${outcomeBadge(live.outcome)} ${statusBadge(live.productState as ProductState)}</div></div><div class="summary-grid"><div><span class="summary-label">Policy</span><strong>${escapeHtml(live.policyState ?? 'UNKNOWN')}</strong><small>${sourceId ? `Tournament ${escapeHtml(formatHash(String(sourceId)))}` : 'No source result observed'}</small></div><div><span class="summary-label">Job state</span><strong>${escapeHtml(live.jobState ?? 'NOT FOUND')}</strong><small>${live.timestamps.updatedAt ? `Updated ${escapeHtml(liveValue(live.timestamps.updatedAt))}` : 'No update timestamp'}</small></div><div><span class="summary-label">Proof</span><strong>${escapeHtml(liveValue(live.attestcoin.preflight))}</strong><small>${live.attestcoin.headerNumber ? `Header ${escapeHtml(liveValue(live.attestcoin.headerNumber))}` : 'Raw proof is never returned'}</small></div><div><span class="summary-label">Settlement</span><strong>${escapeHtml(liveValue(live.settlement.receiptStatus) === '1' ? 'RECEIPT OBSERVED' : liveValue(live.settlement.receiptStatus))}</strong><small>${live.settlement.blockNumber ? `CC3 block ${escapeHtml(liveValue(live.settlement.blockNumber))}` : 'Not confirmed'}</small></div></div>${liveProgress(live)}${apiError ? `<p class="live-error"><strong>${escapeHtml(apiError)}</strong></p>` : ''}</div>`;
}

export function liveEvidenceDetails(live: LiveResponse): string {
  const source = live.source;
  const attestcoin = live.attestcoin;
  const settlement = live.settlement;
  const payout = live.payout;
  const policy = live.policy;
  const replay = live.replay;
  const recovery = live.refundRecovery;
  const links = live.explorerLinks;
  const lifecycle = live.lifecycle ?? [];
  return `<section class="evidence-details live-details"><div class="detail-stack"><section class="detail-section"><div class="detail-section-head"><div><p class="eyebrow">01 · Live source result</p><h3>What the API currently observes</h3></div>${outcomeBadge(source ? 'PASS' : 'UNKNOWN', source ? 'PASS · source record' : 'UNKNOWN · no source record')}</div><dl class="detail-grid">${liveHashRow('Source transaction', source, 'transactionHash', links.source)}${liveHashRow('Source block hash', source, 'blockHash')}${liveRow('Receipt status', source, 'receiptStatus')}${liveRow('Source block', source, 'blockNumber')}${liveRow('Source contract', source, 'registry', liveCopyButton('Copy source contract', liveRecordValue(source, 'registry')))}${liveHashRow('Tournament ID', source, 'tournamentId')}${liveHashRow('Match ID', source, 'matchId')}${liveRow('Player one', source, 'playerOne')}${liveRow('Player two', source, 'playerTwo')}${liveRow('Winner', source, 'winner')}${liveRow('Result', source, 'result')}${liveHashRow('Rules hash', source, 'rulesHash')}${liveRow('Result nonce', source, 'resultNonce')}${liveRow('Event signature', source, 'eventSignature')}${liveRow('Finalized at', source, 'finalizedAt')}${liveRow('Deadline', source, 'deadline')}${liveRow('Gas used', source, 'gasUsed')}</dl></section><section class="detail-section"><div class="detail-section-head"><div><p class="eyebrow">02 · Live Attestcoin state</p><h3>Proof lifecycle, without raw proof bytes</h3></div>${outcomeBadge(liveRecordValue(attestcoin, 'preflight') === 'PASS' ? 'PASS' : 'UNKNOWN', liveRecordValue(attestcoin, 'preflight') === 'PASS' ? 'PASS · native preflight' : 'UNKNOWN · pending or unavailable')}</div><dl class="detail-grid">${liveRow('Chain key', attestcoin, 'chainKey')}${liveRow('Proof status', attestcoin, 'proofStatus')}${liveRow('Proof header', attestcoin, 'headerNumber')}${liveHashRow('Proof digest', attestcoin, 'digest')}${liveRow('Cached', attestcoin, 'cached')}${liveRow('Preflight', attestcoin, 'preflight')}${liveRow('Observed latency', attestcoin, 'latencyMs')}${detailRow('Raw proof', 'UNKNOWN · omitted from API')}</dl><p class="detail-note-block">The browser sees the recorded lifecycle and digest only. Reconstructing raw Merkle/continuity proof bytes remains hosted-prover dependent and is not a browser responsibility.</p></section><section class="detail-section"><div class="detail-section-head"><div><p class="eyebrow">03 · Live Creditcoin state</p><h3>Settlement and frozen policy</h3></div>${outcomeBadge(liveRecordValue(settlement, 'receiptStatus') === 1 && liveRecordValue(settlement, 'tournamentSettled') === true ? 'PASS' : 'UNKNOWN', liveRecordValue(settlement, 'receiptStatus') === 1 && liveRecordValue(settlement, 'tournamentSettled') === true ? 'PASS · settlement observed' : 'UNKNOWN · not settled')}</div><dl class="detail-grid">${liveHashRow('Settlement transaction', settlement, 'transactionHash', links.settlement)}${liveRow('Receipt status', settlement, 'receiptStatus')}${liveRow('CC3 block', settlement, 'blockNumber')}${liveRow('Gas used', settlement, 'gasUsed')}${liveRow('ResultVerified', settlement, 'resultVerified')}${liveRow('TournamentSettled', settlement, 'tournamentSettled')}${liveRow('ASC', settlement, 'asc')}${liveRow('Vault', settlement, 'vault')}${liveRow('Policy state', policy, 'state', String(liveRecordValue(policy, 'state')) === '3' ? ' <span class="detail-note">CLAIMED</span>' : '')}${liveHashRow('Policy source registry', policy, 'sourceRegistry')}${liveRow('Policy source chain key', policy, 'sourceChainKey')}${liveHashRow('Policy rules hash', policy, 'rulesHash')}${liveRow('Policy winner', policy, 'winner')}${liveRow('Policy amount', policy, 'amount')}</dl></section><section class="detail-section"><div class="detail-section-head"><div><p class="eyebrow">04 · Live payout and recovery</p><h3>Terminal evidence and negative paths</h3></div>${outcomeBadge(liveRecordValue(payout, 'prizeClaimed') === true ? 'PASS' : 'UNKNOWN', liveRecordValue(payout, 'prizeClaimed') === true ? 'PASS · payout observed' : 'UNKNOWN · not claimed')}</div><dl class="detail-grid">${liveHashRow('Payout transaction', payout, 'transactionHash', links.payout)}${liveRow('Payout receipt status', payout, 'receiptStatus')}${liveRow('Payout block', payout, 'blockNumber')}${liveRow('Payout gas', payout, 'gasUsed')}${liveRow('PrizeClaimed', payout, 'prizeClaimed')}${liveRow('Payout winner', payout, 'winner')}${liveRow('Payout amount', payout, 'amount')}${liveHashRow('Replay transaction', replay, 'hash', links.replay)}${liveRow('Replay outcome', replay, 'outcome')}${liveRow('Replay receipt status', replay, 'status')}${liveRow('Replay reason', replay, 'reason')}${liveHashRow('Recovery transaction', recovery, 'hash', links.recovery)}${liveRow('Recovery outcome', recovery, 'outcome')}${liveRow('Recovery trigger', recovery, 'trigger')}${liveRow('Recovery beneficiary', recovery, 'beneficiary')}</dl></section>${lifecycle.length ? `<section class="detail-section"><div class="detail-section-head"><div><p class="eyebrow">05 · Durable lifecycle</p><h3>Worker observations</h3></div><span class="muted">${lifecycle.length} recorded transition${lifecycle.length === 1 ? '' : 's'}</span></div><ol class="live-lifecycle">${lifecycle.map((entry) => `<li><time>${escapeHtml(liveValue(entry.at))}</time><strong>${escapeHtml(liveValue(entry.from))} → ${escapeHtml(liveValue(entry.to))}</strong><span>${escapeHtml(liveValue(entry.reason))}</span></li>`).join('')}</ol></section>` : ''}${live.evidenceReferences.length ? `<section class="detail-section"><div class="detail-section-head"><div><p class="eyebrow">Evidence references</p><h3>Inspectable artifacts</h3></div></div><ul class="reference-list">${live.evidenceReferences.map((reference) => `<li><code>${escapeHtml(reference)}</code></li>`).join('')}</ul></section>` : ''}</div></section>`;
}

export function liveLookupPanel(currentId: string, result: DataResult<LiveResponse> | undefined, destination = '/app/evidence', includeDetails = false): string {
  const live = result?.outcome === 'PASS' || result?.outcome === 'FAIL' || result?.data ? result.data : undefined;
  const exampleHref = `${destination}?live=${encodeURIComponent(PUBLIC_CONFIG.currentWorkerTournamentId)}`;
  const unavailable = currentId && result && !live
    ? `<div class="live-result" role="status" aria-live="polite" aria-atomic="true" tabindex="-1">${unavailableState(result.message ?? 'Live state is UNKNOWN. The API did not return a usable envelope.', 'LIVE')}</div>`
    : '';
  const response = live
    ? `<div class="live-result" role="status" aria-live="polite" aria-atomic="false" tabindex="-1">${liveSummary(live)}${includeDetails ? liveEvidenceDetails(live) : ''}</div>`
    : '';
  return `<section class="live-lookup-panel"><div class="live-lookup-copy"><p class="eyebrow">Live worker/API</p><h2>Inspect the current settlement state.</h2><p>Enter a registered tournament ID to read the configured <code>/api/v1</code> boundary. The checked-in default is local-only. The API is read-only; it does not accept proof bytes, payout recipients, or transaction writes.</p><span class="live-endpoint">Endpoint: ${escapeHtml(PUBLIC_CONFIG.apiBaseUrl)}</span></div><form class="live-lookup-form" data-live-lookup data-destination="${escapeHtml(destination)}"><label for="live-tournament-id">Tournament ID<input id="live-tournament-id" name="tournamentId" value="${escapeHtml(currentId)}" placeholder="0x + 64 hexadecimal characters" autocomplete="off" spellcheck="false" /></label><button class="button button-primary" type="submit">Load live state</button><a class="text-link" href="${exampleHref}" data-route="${exampleHref}">Try current worker run →</a></form>${unavailable}${response}${!currentId ? `<p class="live-lookup-note">No live identifier selected. The historical archive remains available below and is labeled separately.</p>` : ''}</section>`;
}

export function apiHealthSummary(result: DataResult<ApiHealthResponse> | undefined): string {
  if (!result?.data) return unavailableState(result?.message ?? 'The local live API health endpoint is unavailable.', 'LIVE');
  const workerLoop = result.data.dependencies?.workerLoop;
  const running = workerLoop && typeof workerLoop === 'object' && (workerLoop as Record<string, unknown>).running === true;
  const dependencyOutcome = (name: string): EvidenceOutcome => {
    const dependency = result.data?.dependencies?.[name];
    if (!dependency || typeof dependency !== 'object') return 'UNKNOWN';
    const outcome = (dependency as Record<string, unknown>).outcome;
    return outcome === 'PASS' || outcome === 'FAIL' || outcome === 'UNKNOWN' ? outcome : 'UNKNOWN';
  };
  return `<div class="api-health" role="status" aria-live="polite" aria-atomic="false"><div><p class="eyebrow">Read API readiness</p><h3>${escapeHtml(running ? 'Worker loop is running' : 'Worker loop is not running')}</h3><p>The health response is live configuration/readiness data, separate from historical evidence.</p></div><div class="summary-state">${modeBadge('LIVE')} ${outcomeBadge(result.outcome)}</div><dl class="health-grid">${detailRow('API endpoint', result.source)}${detailRow('Source RPC', dependencyOutcome('sourceRpc'))}${detailRow('Creditcoin RPC', dependencyOutcome('destinationRpc'))}${detailRow('Attestcoin proof service', dependencyOutcome('proofService'))}${detailRow('ChainInfo', dependencyOutcome('chainInfo'))}${detailRow('Persistence', dependencyOutcome('persistence'))}${detailRow('Worker loop', running ? dependencyOutcome('workerLoop') : 'UNKNOWN · not running')}${detailRow('Raw proof in API', 'No')}</dl></div>`;
}

export function walletControl(snapshot: WalletSnapshot, compact = false): string {
  const statusAttributes = compact ? ' role="status" aria-live="polite" aria-atomic="true"' : ' role="group" aria-label="Browser wallet status"';
  if (snapshot.status === 'UNAVAILABLE') return `<div class="wallet-control wallet-unavailable"${statusAttributes} tabindex="-1"><div><span class="wallet-label">Wallet</span><strong>Not detected</strong><small>${escapeHtml(snapshot.error?.message ?? 'No EIP-1193 provider was found.')}</small></div><button class="button button-secondary" type="button" data-wallet-connect>Try again</button></div>`;
  if (snapshot.status === 'DISCONNECTED') return `<div class="wallet-control wallet-disconnected"${statusAttributes} tabindex="-1"><div><span class="wallet-label">Wallet</span><strong>Not connected</strong><small>Connection is optional and is never treated as authentication.</small></div><button class="button button-secondary" type="button" data-wallet-connect>Connect wallet</button></div>`;
  if (snapshot.status === 'CONNECTING' || snapshot.status === 'SWITCHING') return `<div class="wallet-control wallet-pending"${statusAttributes} tabindex="-1"><div><span class="wallet-label">Wallet</span><strong>${snapshot.status === 'CONNECTING' ? 'Connection pending' : 'Network switch pending'}</strong><small>Confirm or reject the request in your browser wallet.</small></div></div>`;
  if (snapshot.status === 'ERROR' && !snapshot.address) return `<div class="wallet-control wallet-error-state"${statusAttributes} tabindex="-1"><div><span class="wallet-label">Wallet request failed</span><strong>${escapeHtml(snapshot.error?.code ?? 'UNKNOWN')}</strong><small>${escapeHtml(snapshot.error?.message ?? 'The wallet request could not be completed.')}</small></div><button class="button button-secondary" type="button" data-wallet-connect>Try again</button></div>`;
  const error = snapshot.error ? `<p class="wallet-error"><strong>${escapeHtml(snapshot.error.code)}</strong> · ${escapeHtml(snapshot.error.message)}</p>` : '';
  const networkActions = compact ? '' : `<div class="wallet-network-actions"><button class="button button-secondary" type="button" data-wallet-switch="${PUBLIC_CONFIG.botchainChainId}">Use BOT Chain Testnet</button></div>`;
  return `<div class="wallet-control wallet-connected"${statusAttributes} tabindex="-1"><div><span class="wallet-label">Wallet · connected</span><strong>${escapeHtml(formatAddress(snapshot.address ?? 'UNKNOWN'))}</strong><small>${escapeHtml(snapshot.chainName)} · chain ${escapeHtml(liveValue(snapshot.chainId))} · ${snapshot.network === 'WRONG_NETWORK' ? 'wrong network' : 'connected'}</small></div><div class="wallet-actions">${networkActions}<button class="button button-secondary" type="button" data-wallet-disconnect>Disconnect</button></div>${error}</div>`;
}

export function appShell(pathname: string, content: string, wallet: WalletSnapshot): string {
  const links = [
    ['/app', 'Overview'],
    ['/app/tournaments', 'Tournaments'],
    ['/app/evidence', 'Evidence'],
    ['/app/activity', 'Activity'],
    ['/app/profile', 'Profile'],
  ];
  return `<div class="app-shell"><header class="topbar"><a class="brand" href="/" data-route="/"><span class="brand-mark">BOT</span><span>PrizeRail</span></a><div class="topbar-meta"><span class="network-chip"><span class="network-dot"></span>BOT Chain Testnet (968)</span><a class="text-link" href="${PUBLIC_CONFIG.faucetUrl}" target="_blank" rel="noopener noreferrer">Faucet ↗</a><a class="text-link" href="${PUBLIC_CONFIG.botchainExplorer}" target="_blank" rel="noopener noreferrer">Explorer ↗</a><span class="topbar-divider"></span>${walletControl(wallet, true)}<button class="icon-button mobile-menu" type="button" data-menu-toggle aria-expanded="false" aria-controls="workspace-navigation" aria-label="Toggle navigation" title="Toggle navigation">☰</button></div></header><div class="app-body"><aside id="workspace-navigation" class="side-rail" data-side-rail><div class="rail-label">Workspace</div><nav aria-label="Workspace navigation">${links.map(([href, label]) => `<a href="${href}" data-route="${href}" class="rail-link ${pathname === href ? 'is-active' : ''}" ${pathname === href ? 'aria-current="page"' : ''}><span class="rail-icon" aria-hidden="true">${label === 'Overview' ? '⌂' : label === 'Tournaments' ? '◈' : label === 'Evidence' ? '⊙' : label === 'Activity' ? '≋' : '◎'}</span>${label}</a>`).join('')}</nav><div class="rail-spacer"></div><a class="rail-link rail-launch ${pathname === '/app/launch' ? 'is-active' : ''}" href="/app/launch" data-route="/app/launch"><span class="rail-icon" aria-hidden="true">＋</span>Launch tournament</a><div class="rail-foot"><span class="rail-foot-label">Network</span><strong>BOT Chain Testnet</strong><span>Chain ID 968 · Sub-second settlement</span></div></aside><main id="main-content" class="main-content" tabindex="-1">${content}</main></div><footer class="app-footer"><span>PrizeRail on BOT Chain · Verifiable tournament prize escrow</span><span>Native & tokenized settlement with sub-second finality.</span></footer></div>`;
}

function launchStatus(state: LaunchState): string {
  if (state.phase === 'IDLE') return '<p class="disabled-note">No transaction will be sent until you submit this form and confirm each requested wallet transaction.</p>';
  const badge = state.phase === 'SUCCESS'
    ? outcomeBadge('PASS', 'PASS · policy funded')
    : state.phase === 'FAIL'
      ? outcomeBadge('FAIL', 'FAIL · no successful transition')
      : state.phase === 'UNKNOWN'
        ? outcomeBadge('UNKNOWN', 'UNKNOWN · reconcile before retry')
        : `${statusBadge(state.phase === 'READING' ? 'MINED' : state.phase === 'SIGNING' ? 'SUBMITTING' : 'SETTLEMENT_PENDING', state.phase === 'READING' ? 'READING PRECONDITIONS' : state.phase === 'SIGNING' ? 'WALLET CONFIRMATION' : 'AWAITING RECEIPT')} ${outcomeBadge('UNKNOWN', 'PENDING')}`;
  const receipt = state.transaction
    ? hashField('Latest transaction', state.transaction.hash, `${PUBLIC_CONFIG.botchainExplorer}/tx/${state.transaction.hash}`)
    : '';
  const observed = state.transaction?.status === 1
    ? `Mined in BOT Chain block ${state.transaction.blockNumber ?? 'UNKNOWN'} · gas ${state.transaction.gasUsed ?? 'UNKNOWN'}`
    : state.transaction?.status === 0
      ? 'Receipt status 0: the transaction was mined and failed.'
      : '';
  const reads = state.balance !== undefined
    ? `<p class="launch-read">Observed wallet balance: <strong>${escapeHtml(formatAmount(state.balance))}</strong>${state.allowance !== undefined ? ` · allowance: <strong>${escapeHtml(formatAmount(state.allowance))}</strong>` : ''}</p>`
    : '';
  return `<div class="launch-status" data-launch-status role="status" aria-live="polite" tabindex="-1"><div class="launch-status-head"><strong>${escapeHtml(state.step.replaceAll('_', ' '))}</strong><span>${badge}</span></div><p>${escapeHtml(state.message)}</p>${observed ? `<small>${escapeHtml(observed)}</small>` : ''}${receipt ? `<dl class="detail-grid compact-grid">${receipt}</dl>` : ''}${reads}</div>`;
}

export function launchPage(wallet: WalletSnapshot, state: LaunchState, draft: LaunchDraft): string {
  const busy = ['READING', 'SIGNING', 'AWAITING_RECEIPT'].includes(state.phase);
  const canSubmit = wallet.status === 'CONNECTED' && (wallet.network === 'BOT_CHAIN_TESTNET' || wallet.network === 'BOT_CHAIN_MAINNET') && !busy;
  const submitLabel = busy ? 'Transaction in progress…' : state.phase === 'SUCCESS' ? 'Create another policy' : 'Create and fund policy';
  return `<div class="page-header"><div><p class="eyebrow">Launch tournament</p><h1>Create a prize policy.</h1><p class="page-lede">This is the real organizer create/fund boundary on BOT Chain Testnet. It sends explicit BOT Chain wallet transactions only after validation and confirmation.</p></div><div class="page-header-actions">${modeBadge('LIVE')}<span class="muted">Wallet writes · BOT Chain Testnet</span></div></div><section class="launch-layout"><div class="launch-form panel"><div class="panel-kicker">Organizer flow</div><h2>Fund one tournament match.</h2><p class="form-intro">The policy binds the selected source registry, chain ID, rules hash, prize token, amount, and deadlines. The organizer is always the connected wallet.</p><form data-launch-form novalidate><label>Tournament ID<input name="tournamentId" value="${escapeHtml(draft.tournamentId)}" placeholder="0x + 64 hexadecimal characters" pattern="0x[0-9a-fA-F]{64}" required autocomplete="off" spellcheck="false" /></label><label>Source registry<input value="${escapeHtml(formatAddress(PUBLIC_CONFIG.sourceRegistry))}" readonly aria-describedby="launch-config-note" /></label><label>Rules hash<input value="${escapeHtml(PUBLIC_CONFIG.sourceRulesHash)}" readonly /></label><div class="form-row"><label>Amount in PRIZE<input name="amount" value="${escapeHtml(draft.amount)}" placeholder="1" inputmode="decimal" required /></label><label>Organizer<input value="${escapeHtml(wallet.address ? formatAddress(wallet.address) : 'Connect wallet first')}" readonly /></label></div><div class="form-row"><label>Settlement deadline<input name="settlementDeadline" value="${escapeHtml(draft.settlementDeadline)}" placeholder="Unix seconds · future" inputmode="numeric" pattern="[0-9]+" required /></label><label>Refund deadline<input name="refundDeadline" value="${escapeHtml(draft.refundDeadline)}" placeholder="Unix seconds · later" inputmode="numeric" pattern="[0-9]+" required /></label></div><button class="button button-primary" type="submit" ${canSubmit ? '' : 'disabled'}>${escapeHtml(submitLabel)} <span aria-hidden="true">→</span></button><p id="launch-config-note" class="disabled-note">${wallet.status !== 'CONNECTED' ? 'Connect a wallet to continue.' : (wallet.network !== 'BOT_CHAIN_TESTNET' && wallet.network !== 'BOT_CHAIN_MAINNET') ? 'Switch the connected wallet to BOT Chain Testnet to continue.' : 'The next step will read policy, decimals, actual balance, and allowance before requesting a transaction.'}</p></form>${launchStatus(state)}</div><div class="launch-aside"><div class="launch-aside-head"><span class="panel-kicker">State path</span><span>${modeBadge('LIVE', true)}</span></div><h2>Every write has a receipt.</h2><p>Creation, token approval when needed, and funding are separate state transitions on BOT Chain.</p><div class="launch-steps"><div><span>01</span><strong>DRAFT</strong><small>Organizer policy created on BOT Chain</small></div><div><span>02</span><strong>APPROVAL</strong><small>Exact allowance for PrizeVault, only if needed</small></div><div><span>03</span><strong>FUNDED</strong><small>Exact PRIZE reserve held by the vault</small></div><div><span>04</span><strong>SETTLEMENT</strong><small>Settler verifies on-chain match outcome</small></div></div><p class="detail-note-block">PRIZE is a project-owned test token with no monetary value on BOT Chain Testnet. This browser flow reads the connected wallet’s real token balance.</p></div></section>${limitationCallout()}`;
}

export function homeHeader(): string {
  return `<header class="marketing-header"><a class="brand" href="/" data-route="/"><span class="brand-mark">PR</span><span>PrizeRail</span></a><nav class="marketing-nav" aria-label="Primary navigation"><a href="/app" data-route="/app">Open app</a><a href="/app/evidence" data-route="/app/evidence">Evidence archive</a></nav><a class="header-action" href="/app/evidence" data-route="/app/evidence">Inspect a verified run <span aria-hidden="true">↗</span></a></header>`;
}

export function modeLegend(): string {
  return `<div class="mode-legend"><span>${modeBadge('LIVE', true)} <small>chain-backed reads or writes</small></span><span>${modeBadge('HISTORICAL_VERIFIED_RUN', true)} <small>checked-in completed evidence</small></span><span>${modeBadge('DEVELOPMENT_FIXTURE', true)} <small>UI-only state, replaceable by API</small></span></div>`;
}
