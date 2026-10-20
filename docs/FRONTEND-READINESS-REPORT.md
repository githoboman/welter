# Frontend readiness report

Date: 2026-09-13

Phase: implementation and verification of the public-product readiness sprint. The initial route/action audit was completed
read-only before the implementation edits below.

## Product truth and scope

The frontend preserves the approved claims:

- “PrizeRail is the settlement layer for on-chain tournaments. Games determine results; Attestcoin proves them; Creditcoin guarantees the payout.”
- “PrizeRail proves and settles the result recorded by the source game. It does not prove off-chain gameplay fairness or detect cheating.”

The browser organizer path is limited to creating and funding one registered prize policy on the selected CC3 deployment. It
does not choose a winner, accept a payout recipient, submit proof, claim funds, refund a policy, or mint test tokens.

## Initial read-only audit

| Surface | Classification before edits | Evidence |
|---|---|---|
| `/`, `/app`, `/app/tournaments`, `/app/evidence`, `/app/activity`, `/app/profile` | PASS for local rendering and read-only behavior | Browser smoke against the local SPA/API; historical and live modes remained separately labeled. |
| `/app/launch` | INTENTIONALLY DISABLED, not a broken live flow | The route explicitly said no transaction/no-op and did not pretend to create a policy. |
| Wallet connect, disconnect, account/chain events, wrong-network state, switch-network, missing wallet | PASS in provider-state tests | `frontend/src/wallet.test.ts`; real browser extension was not available for this audit. |
| Live lookup, API-unavailable state, malformed identifier | PASS/UNKNOWN as appropriate | Local real-HTTP API test and browser smoke; unavailable infrastructure stayed `UNKNOWN`. |
| Public Sepolia and CC3 RPC reachability | PASS | Sepolia returned chain ID `0xaa36a7`; CC3 returned `0x18e8f`. |
| Public prover health endpoint | UNKNOWN | `https://prover.cc3-testnet.creditcoin.network/health` returned HTTP 404; this was not converted into an outage or success claim. |
| Hosted frontend/API | NOT_DEPLOYED | No host, credentials, or public URLs were supplied or selected. |

## Route and action classifications

| Route/action | Classification | Verification and boundary |
|---|---|---|
| Homepage primary/secondary buttons | `WORKING_READ_ONLY` | SPA navigation to evidence and overview passed in browser smoke. |
| Overview navigation and live lookup | `WORKING_READ_ONLY` | Real local HTTP API lookup is rendered as `LIVE`; no live index is fabricated. |
| Tournament lookup and launch links | `WORKING_READ_ONLY` | Lookup and route navigation passed; launch link reaches the real guarded organizer form. |
| Evidence lookup and evidence detail | `WORKING_READ_ONLY` | Source, Attestcoin, settlement, payout, replay, and historical/live separation passed browser smoke. |
| Activity page | `WORKING_READ_ONLY` | Historical transaction/evidence ledger rendered with authority notes. |
| Profile page and API health | `WORKING_READ_ONLY` | Configuration, wallet state, and local API health rendered; unavailable dependencies remain `UNKNOWN`. |
| Launch form validation and CC3 preconditions | `WORKING_REAL` | Provider/network/identifier guards pass tests; deployment ABI and post-receipt checks are wired. |
| Launch `createTournament`, conditional `approve`, and `fund` | `WORKING_REAL` | Uses actual deployed ABI calls and explicit wallet confirmation; real extension/live receipt is `NOT_TESTED`. |
| Wallet connect and rejected connection | `WORKING_READ_ONLY` | EIP-1193 state/rejection tests pass; extension prompt not exercised. |
| Connected address and local reset/disconnect | `WORKING_READ_ONLY` | Account state and explicit local reset pass provider-state tests. |
| Account changes and chain changes | `WORKING_READ_ONLY` | EIP-1193 event handling passes provider-state tests. |
| Wrong-network handling | `WORKING_READ_ONLY` | Unsupported chain and Sepolia/CC3 classification pass tests. |
| Sepolia and CC3 network switching | `WORKING_READ_ONLY` | Switch request and state update pass provider-state tests; extension confirmation not exercised. |
| Copy controls | `WORKING_READ_ONLY` | Hash/address copy path is wired; clipboard failure is visible instead of false success. |
| Explorer links | `WORKING_READ_ONLY` | Evidence links render only for recorded hashes and passed verifier link checks. |
| Invalid tournament IDs | `WORKING_READ_ONLY` | Validation returns explicit `UNKNOWN`/invalid-input state without an API write. |
| API unavailable state | `INFRASTRUCTURE_UNKNOWN` | Browser smoke confirms unavailable live API remains `UNKNOWN`, not historical `PASS`. |
| Mobile navigation | `WORKING_READ_ONLY` | Menu toggle, `aria-expanded`, and route behavior pass browser smoke. |
| Keyboard navigation and focus | `WORKING_READ_ONLY` | Skip link, route focus, status focus, and responsive accessibility checks pass. |
| Public RPC reachability | `WORKING_READ_ONLY` | Keyless Sepolia/CC3 chain-ID reads passed during the audit. |
| Hosted prover health | `INFRASTRUCTURE_UNKNOWN` | `/health` returned HTTP 404; no outage or success was inferred. |
| Hosted frontend/API | `INFRASTRUCTURE_UNKNOWN` | No public deployment exists, so no external reachability claim is made. |

## Implemented change

The former disabled launch route is now a real, explicit EIP-1193 wallet action. The service:

1. validates the connected account, CC3 chain, fixed deployment bindings, bytes32 tournament ID, amount, and deadlines;
2. reads the latest CC3 block, existing policy, token decimals, wallet balance, and vault allowance;
3. requests `createTournament` with the connected wallet as organizer;
4. requests exact `approve` only when the observed allowance is insufficient; and
5. requests `fund`, then verifies receipt status, vault events, and the resulting policy state.

Each transaction has signing, receipt-wait, failure, and unknown/timeout states. A timeout retains the hash and instructs the
operator to reconcile the explorer and policy before retrying. No automatic retry or recipient override exists. Insufficient
balance fails with an explicit message and does not call the public test-token `mint`.

## Files changed

- Frontend runtime: `frontend/src/config.ts`, `frontend/src/wallet.ts`, `frontend/src/transactions.ts`,
  `frontend/src/transactions.test.ts`, `frontend/src/components.ts`, `frontend/src/main.ts`, and `frontend/styles.css`.
- Build/deployment configuration: `scripts/frontend-build.mjs`, `.env.example`, and `vercel.json`.
- Environment and handoff documentation: `research/ENVIRONMENT-CONTRACT.md`, `docs/PUBLIC-DEPLOYMENT.md`,
  `docs/UI-IMPLEMENTATION.md`, `docs/FRONTEND-CONTRACT.md`, `docs/FRONTEND-STATE-MODEL.md`, `PROJECT-STATE.md`, `KNOWN-ISSUES.md`,
  `NEXT-STEPS.md`, `IMPLEMENTATION-REPORT.md`, and `docs/DURABLE-WORKER-API-CLOSURE-REPORT.md`.

## Verification evidence

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run frontend:build` | PASS |
| `node --import tsx --test frontend/src/transactions.test.ts` | PASS; provider/network/identifier guards and launch rendering covered |
| `node --import tsx --test frontend/src/wallet.test.ts` | PASS; 3 tests |
| `npm run api:test` | PASS over a real HTTP socket |
| `npm run worker:test` | PASS; 61 tests |
| `npm test` (`forge test -vvv`) | PASS; 32 tests |
| `npm run verify:demo -- evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json` | PASS with public RPCs; read-only and no private credentials |
| Browser smoke | PASS for route navigation, local API lookup, evidence separation, missing wallet, malformed ID, API unavailable `UNKNOWN`, keyboard/focus/status/hash checks, and desktop/tablet/mobile no-overflow checks |

The browser smoke used a local frontend and a real local HTTP API backed by a copied v2 worker journal. It performed no wallet
write and did not mutate canonical evidence. The historical source-result → Attestcoin → CC3 settlement → payout → replay
path remains evidenced by the preserved v2 artifact and the read-only verifier; it is not being relabeled as a new browser E2E
run.

## Launch and deployment decision

- Browser wallet test with a real MetaMask/OKX extension: `NOT_TESTED`.
- Live browser create/approve/fund transaction: `NOT_TESTED`; no live write was performed without explicit approval.
- Public frontend URL: none; `NOT_DEPLOYED`.
- Public API/worker URL: none; `NOT_DEPLOYED`.
- Hosting state: no authorized Vercel/Railway/Fly/Render/Netlify CLI, project binding, or deployment credential is present in this workspace.
- Local persistence: fsynced append-only worker journal under `.data/prizerail`.
- Hosted persistence: `NOT_CONFIGURED`; an ephemeral host must not be used.
- Public source-result-to-settlement E2E: not claimed. The release gate is documented in [`PUBLIC-DEPLOYMENT.md`](PUBLIC-DEPLOYMENT.md).

## Known unknowns and deferred scope

The real extension prompt/account/network/receipt path remains to be tested with a dedicated testnet wallet. Hosted HTTPS API
and worker deployment, external CORS checks, public API health, public browser lookup, raw proof reconstruction availability,
production storage/custody/audit, mainnet/real-value prizes, arbitrary source adapters, and Attestcoin writability remain
deferred. The source finalizer remains a disclosed trust boundary: the protocol settles the recorded source result but does not
prove off-chain gameplay fairness or organizer honesty.

The next dependency-aware action is to select and provision a public HTTPS API/worker host with persistent storage and a
separate static frontend origin, then run the release gate before publishing any URL.
