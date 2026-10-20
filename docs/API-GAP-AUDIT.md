# API Gap Audit

Audit date: 2026-09-11.

The repository contains a minimal production-shaped worker, append-only durable job journal, bounded source event scanner, lease/retry/reconciliation loop, and read-only `/api/v1` service. The implementation is in `src/worker-runtime.ts`, `src/durable-store.ts`, and `src/api.ts`; operational commands are `npm run worker` and `npm run api`. The preserved worker-driven Sepolia-to-CC3 artifact records restart/resume, timeout reconciliation, automatic claim, and replay rejection as historical evidence. Current-code closure is now established by the fresh v2 worker/API artifact and documented in [`docs/DURABLE-WORKER-API-CLOSURE-REPORT.md`](DURABLE-WORKER-API-CLOSURE-REPORT.md). The service remains local-only in this milestone and is not a hosted public API.

## Remaining gap register

| Severity | Gap | Current evidence | Minimum work before a live frontend can depend on it |
|---|---|---|---|
| CRITICAL | Hosted process/deployment | The worker/API are implemented and have a fresh live evidence run, but remain local Node processes. | Deploy with persistent storage and publish a browser-reachable URL before claiming hosted availability. |
| NECESSARY | Worker-driven live evidence | The fresh v2 worker/API artifact records current-code discovery through claim, restart/resume, timeout reconciliation, replay rejection, journal/runtime/HTTP/source-version evidence, and independently checked public-chain bindings. The legacy v1 artifact remains historical and read-only. | Keep future artifacts uniquely named and independently verified; do not overwrite preserved artifacts. |
| NECESSARY | File-journal production limits | The journal is fsynced, locked, crash-tail tolerant, restart-tested, and fail-closed on immutable-identity/index collisions. Schema version `1` remains unchanged, but pre-hardening v1 records that clear an assigned transaction hash (or otherwise violate the stricter invariants) are incompatible and fail closed. No migration tool exists. | Preserve incompatible historical journals read-only and use a fresh data directory; any migration must be separately reviewed and reconstructed from on-chain evidence. Move to a managed relational store before horizontal scaling or production custody. |
| NECESSARY | Public config/chain metadata endpoint | `GET /api/v1/config` exposes chain IDs, explorer bases, selected addresses, expected precompiles, feature flags, and deployment provenance. | Host the service and keep the response aligned with the selected manifest. |
| NECESSARY | Read/indexing support | The worker persists a source cursor, source/business indexes, leases, transitions, and bounded reorg rewind; API reads jobs by ID/tournament and reconciles public receipts/events. | Move the journal to managed relational storage before horizontal scaling or production custody. |
| NECESSARY | Error normalization | Worker/API expose `PASS`, `FAIL`, and `UNKNOWN` with stable error classes, retry timestamps, and method/input rejection. | Extend the taxonomy only when a new boundary is added; preserve `UNKNOWN` for infrastructure uncertainty. |
| NECESSARY | Explorer URL generation | Worker evidence and API links are generated from selected chain configuration and persisted with transaction hashes. | Validate any future externally supplied hash before link generation. |
| NECESSARY | Source transaction allowlisting | Worker admission requires the selected deployed source registry and matching funded policy; ASC still binds the proof to the policy-local registry on-chain. | Keep this API guard and document the absence of a global contract allowlist. |
| NECESSARY | Recovery/refund status semantics | `PrizeVault` exposes organizer-window `refund` and permissionless post-deadline `recoverExpired`; `/api/v1/tournaments/:id/status` derives `REFUND_AVAILABLE`, `RECOVERY_AVAILABLE`, and terminal policy states from public reads. | Keep deadline-derived states clearly distinct from persisted policy enum values and preserve `UNKNOWN` on RPC failure. |
| NECESSARY | Role/wallet metadata | Role labels are configured and verified, but the post-fix live run intentionally reuses available wallets for deployer/finalizer/organizer/player-one and worker/player-two/payout-trigger roles. | Publish role labels from chain/config and show the connected wallet per action. Do not infer that the live evidence demonstrates separated operational custody. |
| OPTIONAL | Wallet-authenticated API mutations | Direct contract writes already use wallets; API auth is not implemented. | Add nonce-bound EIP-191/EIP-712 auth only for administrative enqueue/cancel operations if needed. It must not replace contract authorization. |
| OPTIONAL | Raw proof storage/retrieval | Public evidence stores a digest/header and `verified`, not raw proof bytes. | Store encrypted/server-side proof payloads or a content digest if forensic replay is required; omit raw proof from default browser responses. |
| OPTIONAL | Health/readiness endpoints | `GET /api/v1/health` reports sanitized API, persistence, RPC, ChainInfo, proof-service, and worker-loop outcomes. | Host the endpoint and add deployment-level liveness monitoring. |
| POST-HACKATHON | Generic adapter registry | Only `TournamentResultRegistry/RPS` exists. | Add a versioned adapter registry only with a new canonical event specification and live evidence per adapter. |
| POST-HACKATHON | Reorg-aware hosted indexer | Direct RPC is enough for a short demo. | Add finalized-block cursors and rebuild/reconciliation tooling for production availability. |
| POST-HACKATHON | Production custody/auth/audit | Testnet-only keys and token; no audit. | Independent review, separated operational wallets, key management, and real-value policy. |

## Existing script interfaces (not API contracts)

| Script | Inputs | Output | Limitation |
|---|---|---|---|
| `npm run live:preflight` | Server `.env`; private-key env values are read for balances. | JSON network/ChainInfo/prover health snapshot. | No persistence, no auth model, no browser endpoint. |
| `npm run live:e2e` | Server `.env`, deployer/worker keys. | Completed live evidence JSON. | One-shot flow; wallet roles are conflated in the canonical run. |
| `npm run live:complete -- <sourceTxHash>` | Server `.env`, source tx hash, worker key. | Completed/recovered evidence JSON. | Manual resumability only; no job ID or durable retry state. |
| `npm run attestcoin:probe -- <sourceTxHash>` | Server `.env`, source tx hash. | Proof summary/preflight JSON. | Does not submit settlement or persist proof. |
| `npm run verify:proof -- <sourceTxHash>` | Server `.env`, source tx hash. | Optional read-only proof reconstruction/classification. | Read-only diagnostic; proof reconstruction is not part of the standard public evidence verifier. |
| `npm run verify:recovery -- <evidence>` | Recovery evidence JSON and public CC3 RPC. | `PASS`/`FAIL`/`UNKNOWN` recovery checks. | Verifies a completed recovery artifact; no recovery write is performed. |
| `npm run verify:tamper -- <evidence>` | Completed live evidence JSON and public RPCs. | Tamper matrix with expected `FAIL`/`UNKNOWN` classifications. | Harness coverage for verifier boundaries; it is not a backend API or proof of arbitrary RPC availability. |
| `npm run verify:demo [evidence]` | Evidence file and public RPC defaults. | `PASS`/`FAIL`/`UNKNOWN` checks. | Historical evidence verifier; it trusts fields in the evidence bundle and does not reconstruct raw Attestcoin proof bytes. |
| `npm run worker` | Server `.env`; worker key required for settlement/claim. | Long-running bounded watcher, proof, settlement, reconciliation, and optional claim loop. | Single-host journal; local process only. |
| `npm run api` | Server `.env`; no private key needed for read-only routes. | Read-only `/api/v1` HTTP service. | Loopback by default; local process only. |
| `npm run worker:evidence -- <data-dir> <job-id> <replay-hash>` | Completed worker journal and public replay receipt. | Materializes a fresh machine-readable `live-worker` artifact and updates the local journal projection. | Chain reads are read-only; the resulting bundle is verified without writes using recorded proof preflight metadata, and raw proof is omitted. |

## Frontend blocking assessment

The read/status contract now exists and is covered by focused boundary tests. The preserved worker-driven testnet artifact is independently checked by the public read verifier, but it was generated before the stricter journal invariant; reopening its historical journal fails closed on a cleared assigned settlement hash. The fresh post-hardening v2 artifact closes current-code restart/reconciliation evidence for the local worker/API milestone. A truthful full browser demo still requires hosting the API/worker with persistent storage and completing the browser API/wallet integration milestone. Historical evidence must remain visibly separate from live API responses.
