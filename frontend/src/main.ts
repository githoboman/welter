import { repository } from './service.js';
import { initialLaunchState, launchPrizePolicy, type LaunchDraft, type LaunchState } from './transactions.js';
import { BrowserWallet } from './wallet.js';
import type { ApiHealthResponse, DataResult, DeploymentConfig, HistoricalRunEvidence, LiveResponse, RecoveryEvidence, WalletSnapshot } from './domain.js';
import {
  appShell,
  apiHealthSummary,
  deploymentFacts,
  detailRow,
  evidenceDetails,
  evidenceSummary,
  escapeHtml,
  externalLink,
  flowStrip,
  formatAddress,
  formatAmount,
  formatDate,
  formatHash,
  hashField,
  homeHeader,
  limitationCallout,
  liveLookupPanel,
  launchPage,
  modeBadge,
  modeLegend,
  outcomeBadge,
  recoveryDetails,
  resultLabel,
  sectionHeading,
  statusBadge,
  stateCatalog,
  transactionTimeline,
  unavailableState,
  walletControl,
} from './components.js';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('App root not found');
const root: HTMLDivElement = appRoot;

let historical: DataResult<HistoricalRunEvidence> | undefined;
let recovery: DataResult<RecoveryEvidence> | undefined;
let deployment: DataResult<DeploymentConfig> | undefined;
let liveResult: DataResult<LiveResponse> | undefined;
let healthResult: DataResult<ApiHealthResponse> | undefined;
const browserWallet = new BrowserWallet();
let walletState: WalletSnapshot = browserWallet.snapshot;
let launchState: LaunchState = initialLaunchState;
let launchDraft: LaunchDraft = { tournamentId: '', amount: '', settlementDeadline: '', refundDeadline: '' };
let initialRenderComplete = false;

browserWallet.subscribe((snapshot) => {
  walletState = snapshot;
  if (initialRenderComplete) void render('wallet');
});

function passedData<T>(result: DataResult<T> | undefined): T | undefined {
  return result?.outcome === 'PASS' ? result.data : undefined;
}

async function linkClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement;
  const link = target.closest<HTMLAnchorElement>('a[data-route]');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href || href.startsWith('http')) return;
  event.preventDefault();
  history.pushState({}, '', href);
  await render('main');
}

async function liveLookupSubmit(event: SubmitEvent): Promise<void> {
  const form = event.target as HTMLFormElement;
  if (!form.matches('[data-live-lookup]')) return;
  event.preventDefault();
  const value = new FormData(form).get('tournamentId');
  const destination = form.dataset.destination || '/app/evidence';
  const url = new URL(destination, window.location.origin);
  const tournamentId = typeof value === 'string' ? value.trim() : '';
  if (tournamentId) url.searchParams.set('live', tournamentId);
  else url.searchParams.delete('live');
  history.pushState({}, '', `${url.pathname}${url.search}`);
  await render('live');
}

async function launchSubmit(event: SubmitEvent): Promise<void> {
  const form = event.target as HTMLFormElement;
  if (!form.matches('[data-launch-form]')) return;
  event.preventDefault();
  const formData = new FormData(form);
  launchDraft = {
    tournamentId: String(formData.get('tournamentId') ?? '').trim(),
    amount: String(formData.get('amount') ?? '').trim(),
    settlementDeadline: String(formData.get('settlementDeadline') ?? '').trim(),
    refundDeadline: String(formData.get('refundDeadline') ?? '').trim(),
  };
  launchState = { phase: 'READING', step: 'PRECHECK', message: 'Starting read-only wallet and policy preconditions.' };
  await render('launch');
  const finalState = await launchPrizePolicy(walletState, browserWallet.getProvider(), launchDraft, (state) => {
    launchState = state;
    void render('launch');
  });
  launchState = finalState;
  await render('launch');
}

async function render(focusTarget?: 'main' | 'wallet' | 'live' | 'launch'): Promise<void> {
  root.setAttribute('aria-busy', 'true');
  const pathname = window.location.pathname.replace(/\/$/, '') || '/';
  if (!historical) {
    root.innerHTML = '<div class="loading-screen"><span class="loading-mark">PR</span><p>Loading public evidence…</p></div>';
    [historical, recovery, deployment] = await Promise.all([
      repository.getHistoricalRun(),
      repository.getRecoveryEvidence(),
      repository.getDeployment(),
    ]);
  }
  const liveId = currentLiveIdentifier();
  liveResult = liveId ? await repository.getLiveEvidence(liveId) : undefined;
  healthResult = pathname === '/app/profile' || Boolean(liveId) ? await repository.getApiHealth() : undefined;
  const content = routeContent(pathname);
  root.innerHTML = pathname.startsWith('/app') ? appShell(pathname, content, walletState) : content;
  root.setAttribute('aria-busy', 'false');
  document.querySelector<HTMLElement>('[data-side-rail]')?.classList.remove('is-open');
  if (focusTarget === 'main') document.querySelector<HTMLElement>('#main-content')?.focus();
  if (focusTarget === 'wallet') document.querySelector<HTMLElement>('.wallet-control')?.focus();
  if (focusTarget === 'live') document.querySelector<HTMLElement>('.live-result')?.focus();
  if (focusTarget === 'launch') document.querySelector<HTMLElement>('[data-launch-status]')?.focus();
}

function currentLiveIdentifier(): string {
  return new URLSearchParams(window.location.search).get('live')?.trim() ?? '';
}

function routeContent(pathname: string): string {
  if (pathname === '/') return homePage();
  if (pathname === '/app' || pathname === '/app/overview') return overviewPage();
  if (pathname === '/app/tournaments') return tournamentsPage();
  if (pathname === '/app/evidence') return evidencePage();
  if (pathname === '/app/activity') return activityPage();
  if (pathname === '/app/profile') return profilePage();
  if (pathname === '/app/launch') return launchPage(walletState, launchState, launchDraft);
  return notFoundPage();
}

function homePage(): string {
  const run = passedData(historical);
  return `<div class="site-shell">${homeHeader()}<main id="main-content" tabindex="-1"><section class="hero-band"><div class="hero-inner"><div class="hero-copy"><p class="eyebrow eyebrow-light">Proof-bound tournament escrow</p><h1>PrizeRail settles the result your game recorded.</h1><p class="hero-lede">Games determine results on-chain. BOT Chain verifies the predicates and releases the prefunded prize with sub-second finality.</p><div class="hero-actions"><a class="button button-primary" href="/app/launch" data-route="/app/launch">Launch tournament on BOT Chain <span aria-hidden="true">↗</span></a><a class="button button-quiet" href="/app" data-route="/app">Explore the app <span aria-hidden="true">→</span></a></div><p class="hero-footnote"><span class="status-pip"></span>Current browser experience: live on BOT Chain Testnet (Chain ID 968), wallet connection, and public evidence.</p></div><div class="hero-aside"><div class="hero-aside-top"><span class="hero-code">PR / BOT</span><span class="hero-corner">↗</span></div><div class="hero-aside-line"></div><p>One registered match.<br /><strong>Sub-second finality.</strong><br />One frozen winner.</p><span class="hero-aside-caption">BOT Chain Testnet · Chain ID 968</span></div></div></section><section class="flow-band"><div class="content-width">${sectionHeading('The settlement path', 'A result moves through explicit checks.', 'Every handoff has a named authority, a visible state, and inspectable evidence.')}${flowStrip()}${limitationCallout()}</div></section><section class="split-band"><div class="content-width split-grid"><div>${sectionHeading('Why it exists', 'Prize money should follow a proven result.', 'Tournament contracts record outcomes on-chain while prize reserves are locked in escrow. PrizeRail makes the settlement boundary legible: the match outcome is registered, semantic predicates are verified on BOT Chain, and the vault pays the frozen winner.')}</div><div class="principle-list"><article><span class="principle-number">01</span><div><h3>Recorded, not invented</h3><p>The tournament contract derives the winner. A submitter cannot choose a payout recipient.</p></div></article><article><span class="principle-number">02</span><div><h3>Verified before claimable</h3><p>BOT Chain only advances a funded policy after rules hash and event fields match.</p></div></article><article><span class="principle-number">03</span><div><h3>Evidence is part of the product</h3><p>Receipts, blocks, hashes, states, and failure paths stay independently inspectable.</p></div></article></div></div></section><section class="evidence-band"><div class="content-width">${sectionHeading('Start with evidence', 'See the full path, including the rejected replay.', 'The selected post-fix run is preserved as a historical verified run. It is not a live job feed.')}${run ? evidenceSummary(run) : unavailableState(historical?.message ?? 'Historical evidence is unavailable.', 'HISTORICAL_VERIFIED_RUN')}<div class="band-actions"><a class="button button-secondary" href="/app/evidence" data-route="/app/evidence">Open evidence archive <span aria-hidden="true">→</span></a><a class="text-link" href="/app/tournaments" data-route="/app/tournaments">View tournament state <span aria-hidden="true">↗</span></a></div></div></section><section class="trust-band"><div class="content-width trust-grid"><div>${sectionHeading('Trust boundary', 'BOT Chain native verification. PrizeVault settles payout.', 'The settler contract is the correctness boundary.')}</div><div class="trust-facts"><div><span>Network</span><strong>BOT Chain Testnet</strong><small>Chain ID 968</small></div><div><span>Settler</span><strong>BotChainSettler</strong><small>0x81f6...4DE</small></div><div><span>Vault</span><strong>PrizeVault</strong><small>0x6edC...B32</small></div></div></div></section></main><footer class="site-footer"><span>PrizeRail · BOT Chain Testnet foundation</span><span>PRIZE has no monetary value. Off-chain gameplay fairness is outside the claim.</span></footer></div>`;
}

function overviewPage(): string {
  const run = passedData(historical);
  return `<div class="page-header"><div><p class="eyebrow">Overview</p><h1>Settlement workspace</h1><p class="page-lede">A quiet place to follow a tournament from source result to payout, with evidence attached to every critical transition.</p></div><div class="page-header-actions">${modeBadge('LIVE')}<a class="button button-secondary" href="/app/evidence" data-route="/app/evidence">Open evidence ↗</a></div></div><div class="notice-bar"><span class="notice-icon">i</span><p><strong>Live reads are explicit and optional.</strong> Load a tournament ID below to query the read-only worker/API. If it is unavailable, this page keeps the historical archive separate and does not turn it into live state.</p><a href="/app/profile" data-route="/app/profile">See boundaries →</a></div>${liveLookupPanel(currentLiveIdentifier(), liveResult, '/app', false)}<section class="overview-grid">${run ? `<div class="feature-panel">${evidenceSummary(run)}<div class="panel-footer"><span>${modeBadge('HISTORICAL_VERIFIED_RUN', true)}</span><a class="text-link" href="/app/evidence" data-route="/app/evidence">Inspect all predicates →</a></div></div>` : unavailableState(historical?.message ?? 'Historical evidence is unavailable.', 'HISTORICAL_VERIFIED_RUN')}<div class="side-panel"><div class="panel-kicker">Flow state vocabulary</div><h2>What the live API can show</h2><p>These labels are rendered only from the API envelope. No proof job, wallet transaction, balance, or progress percentage is simulated in the browser.</p><div class="state-list"><div>${statusBadge('MINED')}<span>Source receipt confirmed</span></div><div>${statusBadge('AWAITING_ATTESTATION')}<span>Hosted proof is pending</span></div><div>${statusBadge('PROOF_PREFLIGHT_PASS')}<span>Native preflight accepted</span></div><div>${statusBadge('SETTLEMENT_COMPLETE')}<span>Policy is claimable</span></div><div>${statusBadge('REPLAY_REJECTED')}<span>Second submission blocked</span></div></div><span class="fixture-caption">${modeBadge('DEVELOPMENT_FIXTURE', true)} Vocabulary only until a live identifier is loaded</span></div></section><section class="lower-grid"><div class="panel"><div class="panel-kicker">Evidence pulse</div><h2>One completed path, fully inspectable.</h2>${run ? `<div class="metric-line"><div><strong>${escapeHtml(String(run.source.transaction.blockNumber))}</strong><span>source block</span></div><div><strong>${escapeHtml(String(run.destination.settlement.blockNumber))}</strong><span>settlement block</span></div><div><strong>${escapeHtml(String(run.attestation.headerNumber))}</strong><span>proof header</span></div></div>` : unavailableState('Metrics require the historical evidence bundle.', 'HISTORICAL_VERIFIED_RUN')}<a class="text-link" href="/app/activity" data-route="/app/activity">Open activity ledger →</a></div><div class="panel panel-muted"><div class="panel-kicker">Operator note</div><h2>Roles remain visible.</h2><p>The source finalizer creates matches; finalization is permissionless. The worker submits proof but cannot choose the winner. A claim caller triggers payment to the frozen winner.</p><a class="text-link" href="/app/profile" data-route="/app/profile">View role boundaries →</a></div></section>${limitationCallout()}</div>`;
}

function tournamentsPage(): string {
  const run = passedData(historical);
  return `<div class="page-header"><div><p class="eyebrow">Tournaments</p><h1>Follow a funded result.</h1><p class="page-lede">Read one registered tournament from the worker/API, or inspect the separately labeled historical run below. There is no live index route.</p></div><div class="page-header-actions"><a class="button button-primary" href="/app/launch" data-route="/app/launch">Launch a tournament <span aria-hidden="true">＋</span></a></div></div>${liveLookupPanel(currentLiveIdentifier(), liveResult, '/app/tournaments', false)}<div class="mode-line">${modeBadge('HISTORICAL_VERIFIED_RUN')}<span>Archived evidence is not connected to the current wallet.</span></div>${run ? `<article class="tournament-card"><div class="tournament-card-top"><div><span class="card-index">01</span><h2>Post-fix RPS tournament</h2><p>${escapeHtml(formatHash(run.source.decoded.tournamentId))} · source result recorded ${escapeHtml(formatDate(run.source.decoded.finalizedAt))}</p></div><div class="tournament-card-state">${statusBadge('CLAIMED')}<span class="muted">Historical</span></div></div><div class="tournament-meta"><div><span>Prize reserve</span><strong>${escapeHtml(formatAmount(run.destination.amount))}</strong><small>PRIZE test token · no monetary value</small></div><div><span>Winner</span><strong>${escapeHtml(formatAddress(run.source.decoded.winner))}</strong><small>Frozen by source result</small></div><div><span>Source</span><strong>Sepolia</strong><small>Registry ${escapeHtml(formatAddress(run.source.registry))}</small></div><div><span>Destination</span><strong>CC3</strong><small>Vault ${escapeHtml(formatAddress(run.destination.vault))}</small></div></div><div class="tournament-card-footer"><div class="tag-row">${statusBadge('SETTLEMENT_COMPLETE', 'SETTLED')}${statusBadge('PAYOUT_COMPLETE', 'PAID')}${statusBadge('REPLAY_REJECTED')}</div><a class="text-link" href="/app/evidence" data-route="/app/evidence">Inspect run evidence →</a></div></article>` : unavailableState(historical?.message ?? 'Historical tournament unavailable.', 'HISTORICAL_VERIFIED_RUN')}<section class="empty-band"><div class="empty-mark">＋</div><div><p class="eyebrow">Live tournaments</p><h2>No live index is exposed.</h2><p>The worker/API reads a specific tournament ID and proof job. It does not invent a list of live tournaments, so use the lookup above.</p></div><a class="button button-secondary" href="/app/launch" data-route="/app/launch">Review launch boundary</a></section>`;
}

function evidencePage(): string {
  const run = passedData(historical);
  const recoveryEvidence = passedData(recovery);
  return `<div class="page-header"><div><p class="eyebrow">Evidence archive</p><h1>Proof, settlement, payout.</h1><p class="page-lede">Inspect a current worker/API response when available, then compare it with the immutable historical bundle. The two modes never share a status label.</p></div><div class="page-header-actions">${modeBadge('LIVE')}<a class="button button-secondary" href="/app/activity" data-route="/app/activity">Activity ledger →</a></div></div>${liveLookupPanel(currentLiveIdentifier(), liveResult, '/app/evidence', true)}<div class="evidence-toolbar"><div><span class="toolbar-label">Archive source</span><strong>evidence/live-2026-09-10T02-44-30-530Z.json</strong></div><div class="toolbar-status">${outcomeBadge(historical?.outcome ?? 'UNKNOWN', historical?.outcome === 'PASS' ? 'PASS · bundle loaded' : 'UNKNOWN · retry read')}</div></div>${run ? `<section class="evidence-hero">${evidenceSummary(run)}<div class="evidence-hero-actions">${externalLink(run.explorers.source, 'Open source receipt', 'button button-primary')}<a class="text-link" href="/app/profile" data-route="/app/profile">Read limitations →</a></div></section><section class="evidence-details">${evidenceDetails(run)}</section>` : unavailableState(historical?.message ?? 'The evidence bundle could not be loaded.', 'HISTORICAL_VERIFIED_RUN')}${recoveryEvidence ? `<section class="evidence-details recovery-section">${recoveryDetails(recoveryEvidence)}</section>` : ''}<section class="verifier-panel"><div><p class="eyebrow">Third-party verification</p><h2>Reproduce the read-only check.</h2><p>From a fresh checkout, the public verifier checks receipts, events, contract bindings, policy state, payout, and replay without private credentials.</p></div><code>npm run verify:demo</code><span class="muted">Raw Attestcoin proof bytes are not included in the public bundle.</span></section>${limitationCallout()}`;
}

function activityPage(): string {
  const run = passedData(historical);
  return `<div class="page-header"><div><p class="eyebrow">Activity</p><h1>The evidence ledger.</h1><p class="page-lede">Critical transitions are ordered by authority, with transaction links only where a transaction was actually sent.</p></div><div class="page-header-actions">${modeBadge('HISTORICAL_VERIFIED_RUN')}</div></div>${run ? `<section class="activity-panel"><div class="activity-panel-head"><div><span class="panel-kicker">Run ${escapeHtml(run.runId)}</span><h2>Source → proof → payout</h2></div><span class="muted">Observed ${formatDate(run.source.decoded.finalizedAt)}</span></div>${transactionTimeline(run)}</section>` : unavailableState(historical?.message ?? 'The activity ledger is unavailable.', 'HISTORICAL_VERIFIED_RUN')}<section class="activity-notes"><div><span class="note-number">A</span><div><h3>Source authority</h3><p>The source contract derives the winner from revealed moves. The finalizer can create a match, but any gas-paying address can finalize after the guards.</p></div></div><div><span class="note-number">B</span><div><h3>Proof authority</h3><p>Attestcoin establishes inclusion and canonical history. Creditcoin separately checks the receipt, event, policy fields, nonce, and replay domains.</p></div></div><div><span class="note-number">C</span><div><h3>Payout authority</h3><p><code>claimFor</code> is permissionless; the caller cannot redirect funds. The beneficiary is frozen in the policy.</p></div></div></section>`;
}

function profilePage(): string {
  const config = passedData(deployment);
  return `<div class="page-header"><div><p class="eyebrow">Profile / settings</p><h1>Know the boundary.</h1><p class="page-lede">PrizeRail keeps wallets, chain configuration, and trust assumptions visible. No browser key or server credential is needed for this evidence view.</p></div><div class="page-header-actions">${modeBadge('LIVE')}<span class="muted">Configuration and connection</span></div></div><section class="panel wallet-panel"><div class="panel-kicker">Browser wallet</div><h2>Connect for network-aware actions.</h2><p>The wallet adapter uses EIP-1193 only. It can connect, reset locally, request a switch to BOT Chain Testnet (968), and support the explicit organizer policy flow; it does not treat connection as authentication.</p>${walletControl(walletState)}<p class="detail-note-block">No private key, worker key, deployer key, RPC credential, or payout recipient enters the browser. A wallet connection does not choose the winner.</p></section><section class="profile-grid"><div class="panel"><div class="panel-kicker">Network configuration</div><h2>Selected post-fix deployment</h2><p>Public addresses and chain identifiers are safe to display. They describe available reads and evidence links; they do not mean a live worker is connected.</p>${config ? deploymentFacts() : unavailableState(deployment?.message ?? 'Deployment metadata unavailable.', 'LIVE')}<div class="panel-footer"><span class="muted">Manifest: evidence/current-deployment.json → ${escapeHtml(config?.protocolVersion ?? 'UNKNOWN')}</span></div></div><div class="panel"><div class="panel-kicker">Roles in the protocol</div><h2>Actions stay distinct.</h2><div class="role-list"><div><span class="role-swatch role-source"></span><div><strong>Organizer</strong><small>Creates and funds the immutable prize policy.</small></div></div><div><span class="role-swatch role-source"></span><div><strong>Finalizer</strong><small>Creates source matches; finalization itself is permissionless.</small></div></div><div><span class="role-swatch role-proof"></span><div><strong>Settlement worker</strong><small>Submits proof. Contracts choose whether it is valid.</small></div></div><div><span class="role-swatch role-winner"></span><div><strong>Winner</strong><small>Frozen by the accepted source result.</small></div></div><div><span class="role-swatch role-trigger"></span><div><strong>Claim / recovery caller</strong><small>Pays gas to trigger a permissionless action; cannot redirect funds.</small></div></div></div></div></section><section class="profile-grid"><div class="panel panel-muted"><div class="panel-kicker">Current availability</div><h2>Read boundary status</h2>${apiHealthSummary(healthResult)}<div class="availability-list"><div><span>${outcomeBadge(healthResult?.outcome ?? 'UNKNOWN')}</span><p>Live proof job API</p><small>Reads a specific tournament or proof job; there is no public hosted API claim.</small></div><div><span>${statusBadge('UNKNOWN')}</span><p>Browser-safe Attestcoin proof service</p><small>Hosted proof construction remains server-side; the browser never receives raw proof bytes.</small></div><div><span>${modeBadge('LIVE', true)}</span><p>Public chain reads</p><small>The local API performs the server-side public reads; browser wallet connection does not expose RPC credentials.</small></div></div></div><div class="panel"><div class="panel-kicker">Data mode legend</div><h2>Never confuse the source.</h2>${modeLegend()}<p class="detail-note-block">Historical evidence never appears as the current connected wallet or a live pending job. A missing RPC or proof service remains UNKNOWN.</p></div></section><section class="panel state-catalog-panel"><div class="panel-kicker">Protocol state catalog</div><h2>Every important state stays explicit.</h2><p>These labels are frozen by the protocol and state model. Live labels are shown only from an API response; the historical run remains separately populated.</p>${stateCatalog()}</section>${limitationCallout()}`;
}

function notFoundPage(): string {
  return `<div class="not-found"><span class="brand-mark">PR</span><p class="eyebrow">404 · Unknown route</p><h1>This settlement path does not exist.</h1><a class="button button-primary" href="/app" data-route="/app">Return to overview →</a></div>`;
}

document.addEventListener('click', (event) => {
  void linkClick(event);
  const target = event.target as HTMLElement;
  const connect = target.closest<HTMLButtonElement>('[data-wallet-connect]');
  if (connect) void browserWallet.connect();
  const disconnect = target.closest<HTMLButtonElement>('[data-wallet-disconnect]');
  if (disconnect) browserWallet.disconnect();
  const switchButton = target.closest<HTMLButtonElement>('[data-wallet-switch]');
  if (switchButton) {
    const chainId = Number(switchButton.dataset.walletSwitch);
    if (Number.isSafeInteger(chainId) && chainId > 0) void browserWallet.switchNetwork(chainId);
  }
  const copy = target.closest<HTMLButtonElement>('[data-copy]');
  if (copy) {
    const value = copy.dataset.copy;
    if (value) {
      void (async () => {
        try {
          if (!navigator.clipboard) throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(value);
          copy.textContent = '✓';
        } catch {
          copy.textContent = '!';
          copy.title = 'Clipboard unavailable';
        }
        window.setTimeout(() => {
          copy.textContent = '⧉';
          copy.title = copy.getAttribute('aria-label') ?? 'Copy value';
        }, 1200);
      })();
    }
  }
  const menu = target.closest<HTMLButtonElement>('[data-menu-toggle]');
  if (menu) {
    const rail = document.querySelector<HTMLElement>('[data-side-rail]');
    const isOpen = rail?.classList.toggle('is-open') ?? false;
    menu.setAttribute('aria-expanded', String(isOpen));
  }
});

document.addEventListener('submit', (event) => {
  if ((event.target as HTMLElement).matches?.('[data-launch-form]')) void launchSubmit(event);
  else void liveLookupSubmit(event);
});

window.addEventListener('popstate', () => void render('main'));
void (async () => {
  await browserWallet.initialize();
  await render();
  initialRenderComplete = true;
})();
