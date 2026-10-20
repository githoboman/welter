# UI Implementation Handoff

Status: local live worker/API reads and browser wallet observation are wired; the organizer policy create/approve/fund flow is
implemented against the deployed ABI. Hosted API deployment and real browser-extension transaction evidence remain open.

## Routes implemented

| Route | Purpose | Data mode |
|---|---|---|
| `/` | Product entry point, settlement path, limitation, and evidence teaser. | Historical evidence when loaded; static protocol copy otherwise. |
| `/app` | Overview workspace with the selected run, live tournament-ID lookup, typed state vocabulary, and role note. | Historical + explicit `LIVE` API lookup. |
| `/app/tournaments` | Archived tournament card plus explicit live tournament-ID lookup; there is no live index route. | Historical + explicit `LIVE` API lookup. |
| `/app/evidence` | Progressive evidence detail for source, Attestcoin, Creditcoin, payout, replay, recovery, and live API responses. | Historical + explicit `LIVE` API lookup. |
| `/app/activity` | Ordered transaction/evidence ledger with authority notes. | Historical verified run. |
| `/app/profile` | Selected deployment metadata, role boundaries, wallet/network observation, API health, and mode legend. | Live configuration + read-only local API health. |
| `/app/launch` | Organizer create/approve/fund policy flow with fixed deployment bindings and explicit wallet receipts. | Live wallet action, when deliberately submitted. |

The app is a small browser SPA with history navigation and a custom static development server. A separate local HTTP API
and durable worker now exist. The browser uses EIP-1193 for wallet observation, network switching, and explicit organizer
transactions. It never receives a private key, server credential, raw proof payload, or caller-supplied payout recipient.

## Component architecture

- `frontend/src/domain.ts`: data modes, evidence outcomes, protocol/product states, transaction/evidence interfaces, and repository contracts.
- `frontend/src/service.ts`: the repository boundary. It loads historical evidence, deployment metadata, local live status/evidence, and API health; malformed or unavailable data returns `UNKNOWN`.
- `frontend/src/wallet.ts`: the EIP-1193 observation boundary. It handles connect, local reset, account/chain changes, wrong-network state, switching, rejection, and missing-wallet state.
- `frontend/src/config.ts`: browser-safe selected deployment metadata copied from the post-fix manifest. No keys or credentials are present.
- `scripts/frontend-build.mjs` and `vercel.json`: build-time public API configuration and static-host history fallback. No server-only value is injected.
- `frontend/src/components.ts`: status/mode badges, flow strip, evidence summary/detail, timeline, shell, copy/explorer controls, and disclosure primitives.
- `frontend/src/main.ts`: route composition and event delegation. Components receive repository and wallet results instead of scattering fixture objects.
- `frontend/styles.css`: responsive visual system, focus states, reduced-motion behavior, and status treatments.

## Data and fixture boundaries

The historical repository reads:

- `evidence/live-2026-09-10T02-44-30-530Z.json` (`live-f99b1968`, post-fix settlement/payout/replay run).
- `evidence/recovery-f620cf7d.json` (post-refund-window recovery and organizer-beneficiary evidence).
- `evidence/post-fix-deployment-2026-09-10T02-43-34-178Z.json` (selected deployment metadata).

The bundle is normalized only for presentation and remains labeled `HISTORICAL VERIFIED RUN`. It is not tied to the
current wallet. The overview's state vocabulary remains `DEVELOPMENT FIXTURE`: it contains no fabricated transaction,
balance, proof progress, or outcome. `LIVE` is used for explicit API reads and the organizer wallet flow. A missing or
invalid live response is `UNKNOWN`, not a fabricated progress state. The current default is loopback-only
(`http://localhost:3000/api/v1`); this is not a hosted service.

## Historical evidence shown

The evidence route exposes the source transaction, source registry, decoded tournament/match/winner/result/rules/nonce,
source block and gas, Attestcoin chain key/header/digest/preflight/observed latency, ASC/vault addresses, settlement and
payout receipts, final policy state, winner balance, mined status-`0` replay rejection, explorer links, and post-window
recovery. Raw proof bytes are explicitly described as absent from the public bundle.

## Image assets and placeholders

There are no image placeholders in this foundation. No meaningful image slot was required, so no GitHub mark or stock-like
asset was introduced. If an asset is added later, the inventory must include its identifier, route/component, source,
purpose, intended subject/style, dimensions/aspect ratio, crop/focal point, transparency/background needs, replacement
status, and submission-removal requirement.

## Worker/API integration boundary

The local worker/API provides the browser-safe, read-only status/evidence contract below. The frontend calls it through the
repository abstraction; no live write endpoint exists and no raw proof bytes cross into the browser. The API is local-only by
default and must be separately deployed and configured before any hosted availability claim.

1. A unique job key `(sourceChainId, sourceTransactionHash)` and durable job ID.
2. Source receipt confirmation and decoded `MatchFinalized` fields, including registry, tournament, rules hash, winner, result, nonce, deadline, block, timestamp, and gas.
3. Explicit proof lifecycle states: `MINED`, `AWAITING_ATTESTATION`, `PROOF_READY`, `PROOF_PREFLIGHT_PASS`, `PROOF_PREFLIGHT_FAIL`, `INFRASTRUCTURE_UNAVAILABLE`, and retry metadata.
4. Proof header, digest, cached flag, preflight outcome, and a clear distinction between recorded evidence and independently reconstructed raw proof.
5. Settlement submission/receipt reconciliation with target ASC, CC3 block, gas, status, `ResultVerified`, `TournamentSettled`, semantic predicate outcomes, and normalized errors.
6. Policy reads for `DRAFT`, `FUNDED`, `CLAIMABLE`, `CLAIMED`, `REFUNDED`, derived refund/recovery availability, immutable organizer, frozen winner, amount, token, and deadlines.
7. Claim/payout receipt and `PrizeClaimed` event correlation; the API must never accept a caller-supplied payout recipient.
8. Replay evidence distinguishing mined status-`0` rejection from an estimation/preflight rejection without a transaction hash.
9. Refund/recovery evidence with trigger, immutable organizer beneficiary, deadline, receipt, and terminal state.
10. Normalized `PASS`, `FAIL`, and `UNKNOWN` outcomes and public explorer links; no private keys, provider tokens, database URLs, or raw server credentials.

The frontend uses these API methods for explicit tournament-ID lookups without redesigning route composition or components.
The organizer transaction service retains pending/mined-success/mined-failure/timeout reconciliation. It sends only the
deployed `createTournament`, token `approve` when allowance is insufficient, and `fund` calls; it never calls the public
test-token mint. Settlement, claim, refund, and recovery remain worker/permissionless protocol operations, not browser
write controls.

## Known UX limitations

- The organizer flow can send CC3 create/approve/fund transactions after a deliberate wallet confirmation; it has not been
  exercised with a real MetaMask/OKX extension in this environment.
- Live status/evidence is available only after entering a tournament ID and reaching the local API. There is no live index route,
  hosted API, browser proof submission, or browser claim/refund flow.
- Direct public-RPC reads are represented as a future integration boundary, not silently claimed as current live data.
- The Daybreak routes could not be fetched in this environment due DNS failure; the design audit records that limitation.
- PRIZE is a test token with no monetary value; displayed balances are evidence fields, not financial balances.

## Validation commands

```bash
npm run typecheck
npm run frontend:build
node --import tsx --test frontend/src/transactions.test.ts
npm run frontend:dev
```

The dev server serves the app at `http://127.0.0.1:4173` by default, serves evidence JSON read-only, and falls back to
`frontend/index.html` for SPA routes. The local API defaults to `http://localhost:3000/api/v1`; its CORS allowlist must
include the frontend origin. Browser validation should cover the routes above plus `/app/evidence?live=<tournament-id>`,
wallet missing/rejection/wrong-network states, keyboard focus, copy controls, external links, reduced motion, unknown
evidence, and no horizontal overflow. The completed sprint smoke result is recorded in the session handoff below.

## Sprint feasibility result

- Required public verifier gate: `npm run verify:demo -- evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json` — `PASS`.
- Live browser path: `LIVE` read-only lookup is wired to `/tournaments/:tournamentId/evidence` and `/status`; the default API
  is loopback-only and the browser never receives raw proof bytes.
- Wallet path: EIP-1193 connect, local reset, account/chain event handling, wrong-network messaging, supported-network
  switching, and organizer create/approve/fund writes are wired. The real extension path remains NOT_TESTED.
- Evidence status: historical evidence is `HISTORICAL_VERIFIED_RUN`; API responses are `LIVE`; unavailable or malformed live
  infrastructure is `UNKNOWN`. No fake transaction, timer, balance, or proof progress is used.

## Browser smoke record

Exact command used:

```bash
/home/unify/.nvm/versions/node/v22.22.3/bin/node /tmp/prizerail-browser-smoke.mjs
```

The temporary harness started the real API implementation with a copied durable journal in `/tmp`, started the real frontend
dev server, and drove the existing headless Chromium binary through CDP. It did not send a transaction or mutate canonical
evidence. Result: `overall: PASS`.

- API read: `LIVE`, `PASS`, job `job-e997b3df3ae9ed4baddf1c49`, product state `CLAIMED`.
- Browser-visible source, Attestcoin, Creditcoin settlement, payout, replay status, and separate historical archive: PASS.
- API-offline and invalid-identifier handling: `UNKNOWN`/PASS as expected; no historical-to-live fallback.
- Missing-wallet state, keyboard skip-link, SPA route focus, status announcements, hash wrapping, and text-based outcomes: PASS.
- Horizontal overflow: desktop `1425/1425`, tablet `885/885`, mobile `390/390` (`scrollWidth/clientWidth`).
- A real wallet extension connection was not available in headless Chromium and remains `NOT_TESTED`; the EIP-1193 adapter
  state machine is covered by `node --import tsx --test frontend/src/wallet.test.ts`.
- The organizer create/approve/fund path is covered by precondition tests and static ABI inspection; no live write was
  submitted during this sprint.
