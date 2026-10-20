# Durable Worker/API Closure Report

Status: complete for the local single-host MVP path. The worker and read-only API are not hosted and the journal is not a
production relational store; those are deliberately deferred deployment concerns.

## Current-code live evidence

The fresh post-hardening worker run is [`evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json`](../evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json). It uses the deployment selected by `evidence/current-deployment.json` and records:

- real Sepolia `MatchFinalized` discovery at block `11691988`;
- matching funded CC3 policy admission;
- durable job `job-e997b3df3ae9ed4baddf1c49` in a fresh journal;
- Attestcoin proof header `11691988`, digest `0x4215839a3452e4df3062bc6862a51c74c141aba60682f7ef0fe8aab378384d36`, and native preflight `PASS`;
- settlement `0xf0c9d534755b13c48aca8d916795e2db7b8f201b040c9737019d3f28c1d85c65`, mined in CC3 block `5477570`;
- payout `0x6e509ddf7307b49f829e13602ea6a70b74715b783c77796efd7f7a6100799bf9`, mined in CC3 block `5477573`;
- API final projection `LIVE` / `PASS` / `CLAIMED`;
- restart after a pre-stop `AWAITING_ATTESTATION` proof attempt, with first runtime stopped at `2026-09-12T23:02:50.159Z` and the second runtime started at `2026-09-12T23:03:07.475Z`;
- one immutable settlement identity and one immutable payout identity across restart/reconciliation;
- mined replay rejection `0xd068be401c14935d4e80b464471fc1bc82f3bdb4d9ab3244e3e85cf904822f91`, status `0`.

The artifact contains portable journal, runtime, HTTP, source-version, and role-reuse evidence. Raw proof bytes are not
persisted or returned. Git provenance is explicitly `UNKNOWN` because this workspace has no usable Git `HEAD`.

## Verification performed

| Check | Result |
|---|---|
| `forge test -vvv` | 32 passed, including fuzz and adversarial contract paths |
| `npm run typecheck` | PASS |
| `npm run worker:test` | 61 passed |
| `npm run api:test` | PASS over a real HTTP socket |
| `npm run compile:direct` | PASS; Solidity 0.8.28, optimizer, viaIR, Shanghai |
| `npm run verify:adapter` | PASS |
| `npm run verify:evidence` | PASS for the local verifier-double evidence |
| `npm run verify:evidence -- evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json` | Embedded closure checks pass; public-RPC checks remain availability-sensitive and preserve `UNKNOWN` |
| `npm run verify:demo -- evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json` | PASS when public RPC is available |
| `npm run verify:recovery -- evidence/recovery-f620cf7d.json` | PASS |
| `npm run verify:tamper -- evidence/live-2026-09-10T02-44-30-530Z.json` | PASS |
| `npm run verify:roles` | PASS |
| `npm run verify:proof:test` | PASS |
| `npm run frontend:build` | PASS |

## Closure decisions

- The worker uses the real source event, existing Attestcoin proof path, native preflight, configured ASC, and permissionless
  `claimFor`; no load-bearing mock is used.
- The fsynced append-only journal persists observations, cursor, jobs, transitions, leases, proof metadata, transaction
  identities, and API-visible state. Unique source, business, tournament, settlement, and payout indexes are rebuilt on
  restart.
- A transaction hash is persisted before waiting for its receipt. Timeout and uncertain-broadcast paths reconcile public
  receipts, events, replay mappings, and policy state before any retry. Lease expiry permits recovery without authorizing a
  blind duplicate transaction.
- The API is read-only under `/api/v1`; it is bound to the selected deployment and returns normalized, browser-safe live
  envelopes. It never accepts contract targets or payout recipients and never exposes raw proof bytes or server secrets.
- The historical pre-hardening journal remains read-only and intentionally fails closed under current immutable-hash rules.
  No migration is claimed; operators must use a fresh directory unless a separately reviewed migration is reconstructed from
  on-chain evidence.

## Remaining limitations and next milestone

The service remains local-only, single-host, and loopback-bound by default. Hosted API/worker deployment, managed storage,
real wallet-extension transaction evidence, independent production security review, role-separated custody, real-value tokens,
mainnet, and Attestcoin writability remain outside this milestone. The local browser API read and organizer wallet transaction
boundaries are now implemented and separately documented.

The next milestone is hosted API/worker deployment with persistent storage, followed by real extension/browser transaction E2E,
accessibility/HCI review, red-team review, and submission artifacts.
