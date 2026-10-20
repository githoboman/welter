# Backend Freeze

Freeze date: 2026-09-11.

The deployed contracts, checked-in evidence schema, durable worker journal, and read-only API are the current backend source of truth. The worker and API are implemented as local Node processes; they are not a hosted public service or horizontally scalable production backend.

Source-of-truth order for implementation decisions: deployed bytecode/ABI and observed receipts first; selected deployment/evidence manifest second; this audit and the implemented-architecture notes third; historical planning documents only where they agree with code. When a document conflicts with code, the conflict is a known audit finding, not an implemented feature.

## Actual system inventory

| Component | Status | Audit statement |
|---|---|---|
| Source match contract (`TournamentResultRegistry`) | `IMPLEMENTED` | Deployed on Sepolia; deterministic commit/reveal RPS, structured `MatchFinalized`, derived winner/nonce. |
| RPS source adapter | `IMPLEMENTED` | `src/adapter.ts` decodes the expected successful receipt/event and rejects wrong emitters; only RPS is supported. |
| Attestcoin integration | `IMPLEMENTED` | `src/attestcoin.ts` uses USC SDK `0.18.0`, runtime ChainInfo, hosted ProofBuilder, and CC3 native preflight; no service wrapper exists. |
| Creditcoin verification ASC | `IMPLEMENTED` | Deployed `PrizeRailASC`; `verifyAndSettle` invokes native proof verification, decoding, semantic checks, replay, and atomic vault settlement. |
| Semantic checks | `IMPLEMENTED` | Receipt status, event signature, source registry (policy-local), source chain ID/key, tournament, rules, result/status/winner, nonce, deadline, and replay checks are on-chain. |
| Prize vault | `IMPLEMENTED` | Deployed `PrizeVault`; immutable policy fields, ERC-20 reserve, state machine, claim/refund authorization, and non-reentrancy. |
| Settlement | `IMPLEMENTED` | ASC-only `FUNDED -> CLAIMABLE` transition with frozen winner, nonce, and source query key. |
| `claimFor` trigger | `IMPLEMENTED` | Permissionless CC3 call; recipient is the frozen policy winner, never caller-supplied. |
| Payout | `IMPLEMENTED` | Test-token transfer and `PrizeClaimed` event are live-evidenced; token has no monetary value. |
| Replay protection | `IMPLEMENTED` | ASC processed-query, source-query, and business-result domains plus vault claim/state guards. |
| Refund/timeout logic | `IMPLEMENTED POST-FIX` | Organizer refund window plus permissionless post-window recovery to the immutable organizer; source timeout finalization remains permissionless after guards. |
| Deployed contracts and manifest | `IMPLEMENTED` | Current selected addresses, chain IDs, deployment txs/blocks, compiler settings, and precompile addresses are in the versioned post-fix manifest selected by `evidence/current-deployment.json`; `evidence/live-deployment.json` is preserved historical provenance. |
| Live HTTP API | `IMPLEMENTED LOCAL` | Read-only `/api/v1` routes in `src/api.ts`: health, config, tournament status/evidence, and proof-job status. Responses are normalized, browser-safe, and never submit transactions. |
| Durable proof worker | `IMPLEMENTED LOCAL` | `src/worker-runtime.ts` runs bounded discovery, policy admission, Attestcoin proof/preflight, settlement, optional claim, receipt/event reconciliation, retries, leases, and restart recovery. |
| Database/job store | `IMPLEMENTED LOCAL` | `src/durable-store.ts` provides an fsynced append-only journal, normalized uniqueness indexes, immutable job identities, lease fencing, cursor persistence, collision detection, and crash-tail repair. The schema version remains `1`, but that does not guarantee compatibility with pre-hardening v1 records: mutable/cleared assigned transaction hashes and other newly invalid records fail closed. No migration tool exists; preserve incompatible historical journals read-only and use a fresh data directory, or perform a separately reviewed migration reconstructed from on-chain evidence. It is intentionally single-host. |
| Event indexer/reconciliation | `IMPLEMENTED LOCAL` | Source cursor/reorg rewind and destination receipt/event reconciliation are part of the worker; this is not a general hosted indexer. |
| Frontend | `IMPLEMENTED FOUNDATION` | A browser SPA and static bundle exist under `frontend/`, with historical evidence, deployment metadata, state vocabulary, and a disabled wallet/launch preview. Browser API/wallet wiring and hosted live status remain deferred. |
| Read-only verifier | `IMPLEMENTED` | `npm run verify:demo` reads public RPC state and checks a completed evidence bundle; its trust limits are documented below. |
| Scripts and CLI commands | `IMPLEMENTED` | Build/test/deploy/live/probe/verify commands are present in `package.json`; they are not API contracts. |
| Current Sepolia/CC3 testnet evidence | `IMPLEMENTED` | Three historical live runs, the post-fix live run/recovery, the preserved pre-hardening worker-driven artifact, and the fresh post-hardening v2 worker/API artifact are retained; local verifier doubles are labeled non-live. The v2 artifact closes current-code restart/reconciliation evidence. |
| Global source-registry allowlist | `KNOWN LIMITATION` | No contract-wide allowlist; ASC validates only the policy's nonzero `sourceRegistry`. |
| Operational wallet-role separation | `KNOWN LIMITATION` | The post-fix run records explicit role labels and reuse declarations, but deployer/finalizer/organizer/player one and worker/player two/payout trigger still reuse two funded wallets. |
| Independent raw-proof verification in public verifier | `KNOWN LIMITATION` | Raw proof bytes are absent; verifier trusts recorded Attestcoin preflight fields and local ABI artifacts. |
| Post-refund-window recovery | `IMPLEMENTED POST-FIX` | Permissionless `recoverExpired` moves a still-`FUNDED` policy to `REFUNDED` after `refundDeadline` and pays only the immutable organizer; `evidence/recovery-f620cf7d.json` verifies the live path. |
| Targeted edge-case regression coverage | `IMPLEMENTED POST-FIX` | Tests cover non-finalizer finalization, both-commitments reveal ordering, recovery timing/beneficiary/terminal edges, and funds conservation. |
| README | `PLANNED` | No `README.md` exists in the current workspace. |
| License notices | `PLANNED` | No project license/submission notice artifact exists; dependency notices are not a frontend interface. |
| Secret scan | `IMPLEMENTED (MANUAL)` | A final `rg` scan excludes local `.env`, dependencies, generated artifacts, and public hashes; no dedicated secret-scanner binary is installed, so no tool report is claimed. |
| Deck and demo video | `PLANNED` | No deck or video artifact/URL exists. |
| Arbitrary source adapters | `OUT OF SCOPE` | Only the project-owned Sepolia RPS event is supported in the MVP. |
| Attestcoin writability, mainnet, real-value custody, production audit | `OUT OF SCOPE` | Explicitly deferred by the project constitution and implementation report. |

Remaining limitations are called out below: no global registry allowlist, role reuse in live evidence, hosted proof-reconstruction availability, single-host worker/API deployment, and browser API/wallet integration still deferred.

## Available scripts and CLI commands

These are the complete `package.json` commands at freeze time. They are local CLI operations, not network APIs.

| Command | Purpose | Status |
|---|---|---|
| `npm test` / `npm run build` | Foundry tests/build | `IMPLEMENTED` |
| `npm run typecheck` | TypeScript typecheck | `IMPLEMENTED` |
| `npm run compile:direct` | Direct Solidity compilation/artifact generation | `IMPLEMENTED` |
| `npm run local:e2e` | Local Anvil + verifier-double flow | `IMPLEMENTED`, non-live evidence |
| `npm run local:e2e:three` | Record three local verifier-double runs | `IMPLEMENTED`, non-live evidence |
| `npm run verify:evidence` | Structural evidence assertion | `IMPLEMENTED` |
| `npm run verify:adapter` | RPS event adapter check | `IMPLEMENTED` |
| `npm run verify:demo` | Public read-only verification of a completed bundle | `IMPLEMENTED` with documented trust limits |
| `npm run verify:proof` / `npm run verify:proof:test` | Optional proof reconstruction and classification tests | `IMPLEMENTED`, read-only/diagnostic |
| `npm run verify:recovery` | Public read-only verification of recorded expired recovery | `IMPLEMENTED` |
| `npm run verify:roles` | Explicit role-key/reuse configuration validation | `IMPLEMENTED` |
| `npm run verify:tamper` | Evidence tamper classification matrix | `IMPLEMENTED` |
| `npm run live:preflight` | Network/ChainInfo/prover/balance health snapshot | `IMPLEMENTED`, server env required |
| `npm run live:deploy` | Deploy selected contracts and write manifest | `IMPLEMENTED`, deployer key required |
| `npm run live:e2e` | One-shot live create/fund/play/prove/settle/claim/replay | `IMPLEMENTED`, server keys required |
| `npm run live:complete -- <source-tx-hash>` | Manual source-hash completion/recovery flow | `IMPLEMENTED`, server worker key required |
| `npm run attestcoin:probe -- <source-tx-hash>` | Proof retrieval/preflight summary | `IMPLEMENTED`, server env required |
| `npm run worker` | Long-running local worker with journal/retry/reconciliation loop | `IMPLEMENTED`, server env and worker key required for writes |
| `npm run api` | Read-only local `/api/v1` HTTP service | `IMPLEMENTED`, server env optional for public-read routes |
| `npm run worker:evidence -- <data-dir> <job-id> <replay-tx-hash>` | Validate public chain state and record a live-worker evidence artifact (local journal/file writes) | `IMPLEMENTED`, public RPC plus completed journal required |

The API and worker are local processes; no hosted deployment or horizontal coordination is included.

## Available code-level interfaces

These exports are usable by Node/TypeScript scripts but are not browser or HTTP contracts:

| Export | File | Behavior | Status |
|---|---|---|---|
| `SourceResultAdapter<Result>` | `src/adapter.ts` | Type boundary for a canonical source-event decoder and business key. | `IMPLEMENTED` |
| `decodeRpsMatchFinalized(receipt, sourceContract)` | `src/adapter.ts` | Requires receipt status `1`; decodes `MatchFinalized` only from the expected emitter. | `IMPLEMENTED` |
| `rpsMatchFinalizedAdapter` | `src/adapter.ts` | The only configured adapter; business key is `tournamentId:resultNonce`. | `IMPLEMENTED` |
| `proofToQuery(proof)` | `src/adapter.ts` | Maps SDK proof fields to native ASC query arguments without changing bytes. | `IMPLEMENTED` |
| `getAttestcoinProof(sourceRpc, creditcoinRpc, proverUrl, txHash, expectedChainKey)` | `src/attestcoin.ts` | Queries ChainInfo, checks source receipt, waits for hosted attestation, gets proof, and preflights CC3 native verification. | `IMPLEMENTED`, server-side/script use only |

## Canonical live evidence

The preserved worker-driven run is `worker-live-28e7fb00` (`evidence/worker-live-2026-09-11T22-00-53-430Z.json`). It demonstrates bounded discovery, restart while awaiting attestation, proof/preflight, timeout reconciliation, one settlement, one payout, and replay rejection as historical evidence generated before the stricter journal invariant. The corresponding historical journal contains a pre-hardening snapshot that clears an assigned settlement hash, so current code intentionally refuses to reopen it. Current-code closure is provided by the fresh post-hardening v2 artifact [`evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json`](../evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json) and the [`DURABLE-WORKER-API-CLOSURE-REPORT.md`](DURABLE-WORKER-API-CLOSURE-REPORT.md). The three baseline one-shot runs and the separate post-fix one-shot run remain listed in `research/E2E-RUN-LOG.md` as historical provenance. Future recorder runs use a timestamp, process ID, and random suffix, and publish through an exclusive filesystem link so an existing evidence artifact is never replaced.

| Artifact | Hash/identifier | Chain/block | Gas/status |
|---|---|---|---|
| `MatchFinalized` source tx | `0x1ff6354200b553b10a8b7714a7837bd0ab8791a200d4c734369e998b643e36a6` | Sepolia / 11679976 | 90467 / status `1` |
| Attestcoin proof digest | `0x4d3245c17b37fdc1f3bd8cf96e9639de5f80a974d01c6e42703c143696c9abd9` | header 11679976 | preflight `verified=true`, observed 20.298s |
| Settlement tx | `0x6f71453dfe83b01e7b93317bdbc570b5ee6792693579891b0fd69e67b7964e59` | CC3 / 5467691 | 239642 / status `1` |
| Payout tx | `0x00c3c3141f28f495ba2f51765d37aed5b53873957a14874e6c1c8dc75bda042c` | CC3 / 5467694 | 81592 / status `1` |
| Replay attempt | `0x834c3e786fa5448e79d4ab4bedcb535d341f509b41d7e27af1bfb9f69eb9ab08` | CC3 / 5471266 | 153230 / status `0` |

These are historical artifacts, not a live job feed or service-level guarantee.

## Stable interfaces

These interfaces are implemented, deployed, and evidenced. Frontend code may depend on their semantics and current addresses from the post-fix manifest selected by `evidence/current-deployment.json`; historical addresses remain in `evidence/live-deployment.json` for the preserved three-run record.

### Sepolia source

- `TournamentResultRegistry.MatchCreated`, `MoveCommitted`, `MoveRevealed`, and `MatchFinalized` event signatures and field order.
- `matches(bytes32)` return layout and enum meanings.
- `sourceChainId()` and `finalizer()` reads.
- `createMatch(...)` is restricted to `finalizer`.
- `commit(...)` and `reveal(...)` are player-bound.
- `finalize(...)` is permissionless after both reveals or after the reveal deadline; it derives the winner and cannot accept a caller-supplied winner.
- RPS result encoding: Rock `1`, Paper `2`, Scissors `3`; result/status and nonce rules in `research/IMPLEMENTED-ARCHITECTURE.md` and the contract.

### Creditcoin vault

- `PrizeVault.Policy` return layout and state enum: `DRAFT=0`, `FUNDED=1`, `CLAIMABLE=2`, `CLAIMED=3`, `REFUNDED=4`.
- `policies(bytes32)` and `settlementAuthority()` reads.
- `createTournament(...)`, `fund(...)`, `claimFor(...)`, `refund(...)`, and `recoverExpired(...)` signatures and authorization/deadline behavior.
- `settle(...)` is callable only by the immutable ASC settlement authority.
- `claimFor(...)` is permissionless and always pays the frozen policy winner.
- Normal refund is organizer-only after settlement deadline and at or before refund deadline. Post-window recovery is permissionless, uses `REFUNDED`, and pays only the immutable organizer.
- Vault events: `TournamentCreated`, `TournamentFunded`, `TournamentSettled`, `PrizeClaimed`, `TournamentRefunded`, `TournamentRecovered`.

### Creditcoin ASC

- `PrizeRailASC.verifyAndSettle(...)` proof payload shape, action `0`, expected chain key `1`, and custom error names.
- `ResultVerified` event and replay mappings.
- Native `0x0FD2` verifier and runtime ChainInfo expectation are part of the deployed configuration.
- Proof acceptance is followed by on-chain receipt/event/policy semantic validation and atomic `vault.settle`.

## Stable product/evidence facts

- Selected post-fix source registry: `0xDdDA859AC766E3eaE59Dc7b7B85465610aF90a3f` on Sepolia; the historical three-run registry is retained in `evidence/live-deployment.json`.
- Selected post-fix CC3 token/vault/ASC addresses are the versioned manifest values selected by `evidence/current-deployment.json`.
- Source chain ID is `11155111`; CC3 chain ID is `102031`; Attestcoin chain key `1` maps to Sepolia when ChainInfo confirms it.
- The product limitation is fixed: PrizeRail settles a recorded source result; it does not prove off-chain fairness or detect cheating.
- Three complete live runs and their hashes are preserved in `research/E2E-RUN-LOG.md` and `evidence/`.

## Unstable or absent interfaces

- No hosted API URL, authentication scheme, mutation endpoint, or horizontally coordinated worker deployment exists. The local read-only API contract is documented in `docs/API.md`.
- The file journal is not a managed database and the worker is not a general-purpose indexer; both are single-host demo components.
- CLI stdout is not a stable machine API. Scripts select a versioned deployment manifest; recovery scan ranges and internal orchestration may change.
- Historical evidence JSON is useful but has multiple writer shapes. The local API normalizes fields such as `cached` and latency metadata without changing the meaning of historical files.
- Raw proof bytes are not stored in the public bundle. `attestation.verified` is recorded preflight evidence, not a self-contained public proof artifact.
- The inherited `ASCBase.execute(...)` is externally callable but is not the chosen frontend interface; only `verifyAndSettle(...)` has project-specific errors and live evidence.
- The public verifier uses local ABI artifacts and evidence-supplied addresses/hashes. It is a read-only evidence checker, not a fully independent Attestcoin proof verifier.

## Interfaces that must not change during frontend construction

1. Deployed addresses, chain IDs, selected Attestcoin chain key, explorer bases, and source event signature.
2. Event field order and the numeric policy/result/status enum meanings.
3. `FUNDED -> CLAIMABLE -> CLAIMED` and `FUNDED -> REFUNDED` state semantics.
4. Permissionless `finalize` guard behavior and permissionless `claimFor` recipient behavior.
5. ASC semantic checks, replay domains, atomic settlement, and custom error names.
6. The evidence limitation and trust disclosures.
7. The distinction between `UNKNOWN` infrastructure state and terminal semantic `FAIL`.

## Interfaces that may change with an explicit migration note

- HTTP/API route names, auth, pagination, polling cadence, job storage, and worker deployment.
- Normalized evidence JSON/API envelope, provided historical fields remain readable.
- Wallet-role separation in future live deployments. The canonical runs use the same address for deployer, source finalizer, organizer, and player one, and the worker address for player two and worker submission; this is evidence of the script setup, not the desired custody model.
- API-level registry allowlisting and source-tx admission checks. The current contracts bind a policy to any nonzero registry and do not maintain a global allowlist.
- A future protocol change still requires a new deployment/version note; frontend code may depend on post-fix recovery only when configured to the post-fix manifest.

## Freeze rule

During frontend construction, add only read adapters, wallet transaction handling, and the explicitly documented worker/API. Do not silently change contract semantics, broaden supported source registries, add arbitrary adapters, or turn historical evidence into simulated live state. Any protocol change requires a new deployment manifest, new negative/live evidence, and an update to this file before UI claims change.

## Final readiness check

1. **Can a frontend be built against the current implementation?** Yes for direct public-RPC reads, wallet transaction screens, historical evidence, and the local live asynchronous status/evidence routes. A hosted browser demo still requires deployment of the API/worker.
2. **What is missing?** Hosted process/storage, browser wallet integration, and the remaining submission artifacts (README, license notices, secret-scan artifact, deck, and video).
3. **Which missing pieces block the frontend?** No code-level worker/API gap blocks local integration; hosting and browser wallet wiring block a public live demo.
4. **Which missing pieces can be deferred?** Generic adapters, a hosted indexer, API authentication for direct wallet writes, raw proof storage, production custody/audit, and real-value/mainnet support.
5. **Are current contracts/API behaviors ambiguous?** Contract behavior is inspectable, but stale planning language needed correction: `finalize` is permissionless; registry binding is policy-local; post-window recovery now terminates an expired funded policy in `REFUNDED`; the inherited `execute` entrypoint is not the chosen frontend path; and the public verifier is evidence-bundle based. The local read-only API is documented in `docs/API.md`; hosting/authentication remain deployment decisions.
6. **Does the UI need a backend worker?** `claimFor` can support payout without a privileged worker because it is permissionless. The local worker/API waits for hosted attestation, stores/reconciles jobs, and exposes asynchronous states; a hosted deployment is still needed for a public browser demo. One-shot scripts remain operational tools, not the frontend backend.
7. **Are all user-visible states represented?** Yes in `docs/FRONTEND-STATE-MODEL.md` and the API envelope, with explicit separation between on-chain states, derived deadline states, proof lifecycle states, and `UNKNOWN` infrastructure states. An internally inconsistent `CLAIMED` record is downgraded to `UNKNOWN` until payout receipt/event evidence is present.
8. **Can every important frontend claim be backed by real on-chain evidence?** Yes for source receipt/event, CC3 semantic settlement, claim/payout, policy state, replay receipt, blocks, timestamps, gas, and explorer links in the selected runs. No for off-chain fairness/anti-cheat, a live worker SLA, raw proof reconstruction from the public bundle, or role-separated custody.
