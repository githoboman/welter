# Public deployment preparation report

Snapshot: 2026-09-13. Phase: implementation, local validation and publication audit. No commit, push, external project,
deployment, blockchain transaction, contract change or evidence rewrite was performed.

## 1. Git publication readiness

**FAIL.** The local directory has no usable Git metadata. The verified target is the public, currently empty
`unifyWeb3/prizerail` repository. Dependency findings also remain unresolved. This report is a reviewable preparation result,
not authorization or a claim that publication has happened.

## 2. Files eligible for publication

[PUBLICATION-FILES.txt](PUBLICATION-FILES.txt) lists the exact relative paths. The inventory covers source, tests, documentation,
configuration and vendored Solidity source, including all 14 reviewed historical evidence JSON files. The manifest selector
and files used by the default public verifier are included. Historical worker artifacts contain curated, portable embedded
journal snapshots and public transaction/state data; mutable .data journals and proof caches are excluded.

The browser deployment includes only seven generated files: index.html, styles.css, dist/app.js, dist/app.js.map and the three
allowlisted evidence files listed below. Source maps contain browser source and were scanned alongside the bundle.

## 3. Files that remain local

`.env`, real credentials and keyed URLs; `.data/`, live journals, proof caches and databases; `node_modules/`; `artifacts/`,
`out/`, `cache/`, `coverage/`; `frontend/dist/`, `frontend/evidence/`, `frontend/public/` (generated output);
`lib/openzeppelin-contracts/build/`; `.vercel/`, `.render/`; logs and temporary test artifacts. `.env.example` is public-safe.
No local private material was deleted. Existing evidence and runtime journals were preserved.

## 4. Git state and publication procedure

Local branch, HEAD, remotes, index and tracked/untracked classification are unavailable: all relevant Git commands report
`not a git repository`, including an audit outside the sandbox. `.git/` is empty. GitHub metadata reports default branch
`main`, size zero and public visibility; `git ls-remote --symref` exits zero with no advertised HEAD or branch refs. Thus no
remote commit contains the current implementation, and there is no commit base for an exact Git patch.

[PUBLICATION-AUDIT.md](PUBLICATION-AUDIT.md) records the commands and a non-destructive procedure: recheck target refs,
preserve this worktree, use a fresh checkout or restored intended metadata, transfer only the reviewed inventory, inspect
status and the full staged patch, rerun checks, and commit/push only after separate authorization. Do not force-push or use
clean/reset to create a convenient state. The edited-file list below is not presented as a Git diff.

## 5. Exact recommended Render settings

| Setting | Value |
|---|---|
| Service | One paid Web Service; one instance |
| Runtime | Native Node; `NODE_VERSION=22.22.3` |
| Root | Repository root; leave root-directory field blank |
| Compute | `1c-2g` / legacy Standard, 1 CPU and 2 GB; starting recommendation |
| Build | `npm ci --include=dev && npm run compile:direct` |
| Start | `npm run start:render` |
| Health path | `/api/v1/live` — API process liveness only |
| Readiness | `/api/v1/health` — dependency outcomes, including HTTP 503 / UNKNOWN |
| Disk | One 1 GB persistent disk mounted at `/var/data` |
| Storage | `PRIZERAIL_DATA_DIR=/var/data/prizerail` |
| Bind | `HOST=0.0.0.0`; leave `PORT` for Render to supply |

The recommended paid plan supports a persistent disk. Both children execute inside the same service instance and inherit
the same path, satisfying the disk-sharing requirement. A separate worker service would not. The actual dashboard plan,
disk attachment and mount have not been created or verified in an account. The current official documentation and dated
source links are in [PUBLIC-DEPLOYMENT.md](PUBLIC-DEPLOYMENT.md). Disk-backed deployment has downtime and the disk is unavailable
during build; generated backend artifacts are compiled in the build filesystem.

## 6. Exact recommended Vercel settings

| Setting | Value |
|---|---|
| Framework | Other / static SPA |
| Root | Repository root; leave root-directory field blank |
| Node build version | `22.x` in project settings |
| Install | `npm ci --include=dev` |
| Build | `npm run frontend:build` |
| Output | `frontend/public` |
| SPA rewrites | `/app` and `/app/:path*` to `/index.html`, supplied by vercel.json |

Stable evidence URLs:

- `/evidence/live-2026-09-10T02-44-30-530Z.json`
- `/evidence/recovery-f620cf7d.json`
- `/evidence/post-fix-deployment-2026-09-10T02-43-34-178Z.json`

## 7. Platform environment

[PUBLIC-ENVIRONMENT.md](PUBLIC-ENVIRONMENT.md) is the complete classified inventory with exact public address/hash values,
sources, formats, missing behavior and copyable platform settings. [../.env.example](../.env.example) is the safe local template;
[../research/ENVIRONMENT-CONTRACT.md](../research/ENVIRONMENT-CONTRACT.md) records actual consumers and operating boundaries.

Render requires the runtime/storage/bind settings above, the selected deployment manifest, CORS origins for the eventual
Vercel host, server RPC/prover configuration and the authorized settlement worker's `WORKER_PRIVATE_KEY` as a secret.
`WORKER_AUTO_CLAIM=false` is recommended. Keyless RPC/prover defaults exist; keyed replacements remain server-only. Do not
upload deployer, finalizer, organizer, player or payout-trigger secrets. The worker key must match the immutable ASC worker
address in the selected manifest. This task did not test new hosted signing or balances.

Vercel receives only the explicit `NEXT_PUBLIC_*` browser configuration, especially
`NEXT_PUBLIC_API_BASE_URL=https://<render-service>.onrender.com/api/v1`. The build uses esbuild, deliberately consumes those
names, and injects a small allowlisted object; it does not load .env or expose all process variables. No browser RPC environment
variable is consumed. The actual future hostnames are pending project creation and must replace the marked placeholders.

## 8. Combined service and persistence

**PASS for local infrastructure behavior.** The wrapper starts both real entry points, labels API/worker logs, forwards parent
termination, drains normal worker activity, and fails if a critical child exits unexpectedly—even with exit code zero.
A ten-second shutdown deadline forces remaining children to stop and returns nonzero. Startup worker errors are sanitized.

The Node 22 integration suite passed three cases: two launches against the same journal with an unchanged persisted cursor
and a new worker heartbeat owner, parent-only SIGTERM with both children exiting zero, startup worker failure stopping the
API, and an unexpectedly clean worker exit producing supervisor exit 1. Directory/journal modes were verified as 0700/0600.
API was bound to 0.0.0.0 on a supplied ephemeral PORT; `/live` returned 200 with `API_PROCESS_ONLY`, while `/health` returned
503 / UNKNOWN with persistence and observed worker heartbeat PASS during unavailable RPC/prover dependencies.

These tests used only loopback unavailable endpoints, isolated temporary storage and a public test scalar. They sent no
blockchain transactions and do not establish current-code cross-chain settlement. Local restart persistence is demonstrated;
Render account-level disk persistence remains a deployment check.

## 9. Evidence packaging and local browser

**PASS for packaging and local browser function.** Build output contains exactly the seven expected files. Isolated failure
tests confirm missing evidence fails, secret-marker-bearing evidence fails, and a server-secret sentinel does not enter the
bundle. Local development serves the same static output. Chromium loaded all three JSON assets with HTTP 200 and JSON
content type; non-allowlisted evidence, source files and .env paths returned 404.

Four routes (`/`, `/app`, `/app/evidence`, `/app/launch`) loaded at 1280 and 390 pixels with no JavaScript page errors. The
evidence page displayed its bundle-loaded label. All eight checks found one main landmark, one h1, document language and
keyboard focus. **Mobile layout FAIL:** on `/app` at width 390, overview panels reach x=414, causing 24 pixels of horizontal
overflow. Other checked route/width combinations did not overflow. This narrow packaging task does not include an unrelated
responsive-layout redesign. These are basic accessibility checks, not a complete WCAG audit.

| Evidence category | Status |
|---|---|
| Local browser function | PASS; layout issue recorded separately |
| Public frontend smoke | NOT_RUN — no deployment |
| Public hosted API reads | NOT_RUN — no deployment |
| Local API transport/shared persistence | PASS |
| Real wallet extension transaction | NOT_RUN — no extension transaction observed |
| New full source-result-to-settlement E2E | NOT_RUN — new blockchain writes prohibited |
| Preserved historical chain evidence | Independently read; verifier limitations below |

## Validation and security evidence

Required gates were run: typecheck, frontend:build, compile:direct (16 backend artifacts), build, npm test, worker:test,
api:test and forge test. Contract suite: 32 passing tests, including 256-case funds-conservation fuzz tests. Worker suite:
61 passing tests. HTTP suite: one passing real-socket fixture. Browser wallet/launch units: six passing simulated-provider
tests. Packaging failure test: one passing test. Combined service Node 22 suite: three passing tests.

The final post-edit sequence completed with exit 0 for all eight required gates, using Node 22.22.3 for the application
checks. The publication result remains FAIL for the separately recorded blockers.

Read-only verifier results:

| Command / artifact | Observed result |
|---|---|
| verify:adapter | PASS |
| verify:proof:test | PASS |
| verify:roles | PASS with generated local test role keys |
| verify:evidence default | PASS for the local-verifier-double artifact only |
| verify:recovery recovery-f620cf7d | PASS, 10 public read checks |
| verify:tamper post-fix live artifact | PASS, all 11 expected FAIL/UNKNOWN classifications after public RPC access was available |
| verify:demo default live-latest | UNKNOWN; prior public RPC/read timeouts; unchanged verifier and evidence |
| verify:proof live-latest | UNKNOWN; source receipt/proof reconstruction not established in that attempt |
| verify:evidence worker-live-v2 | FAIL after source hash changes; embedded journal checks and public receipts/policy checks pass |

The historical worker artifact records hashes for code before this deployment preparation. It must not be rewritten to make
the current source pass. Five of its fourteen recorded files changed: src/worker-runtime.ts, src/api.ts, scripts/worker.ts,
scripts/api.ts and package.json. Recorded compiler artifact hashes still match. A future separately authorized run can provide evidence for changed runtime code. Default demo
UNKNOWN is explicitly a submission-hardening item; no verifier condition was weakened or skipped to claim overall PASS.

Secret checks: the known-local-value scan passed for publication candidates and all seven static files. All 14 evidence
objects were checked for non-null private-key/mnemonic/credential/raw-proof fields with none found. Default Gitleaks findings
were reviewed as public addresses/query hashes/source hashes; raw scanner exit status and counts are in PUBLICATION-AUDIT.md.
No Git history scan was possible because neither local nor advertised remote history is available.

Final inventory: 523 existing files; no private paths or missing entries. All 52 variables explicitly assigned or shown as
role-reuse examples in .env.example have named documentation. Final Gitleaks source scan: 81 findings, all reviewed public
values (58 token-address occurrences, 21 query hashes, two file hashes); browser scan: three public token-address occurrences.
No unclassified finding remained. Gitleaks raw exit 1 is retained, not reported as an automatic clean scan.

Reproduce the added local checks with `node --import tsx --test test/render-startup.test.ts`,
`node test/frontend-packaging.test.mjs`, and `node scripts/publication-scan.mjs`. Use Node 22.22.3 for the hosted-runtime check.
The scanner's temporary snapshot path can be passed to `gitleaks dir <snapshot> --redact`; independently scan
`gitleaks dir frontend/public --redact`. Review public hash/address findings in context rather than deleting evidence.

Dependency audit: `npm audit` reports low solc and high tmp findings (development compiler dependency), including
[GHSA-52f5-9888-hmc6](https://github.com/advisories/GHSA-52f5-9888-hmc6) and
[GHSA-ph9p-34f9-6g65](https://github.com/advisories/GHSA-ph9p-34f9-6g65).
`npm audit --omit=dev` reports zero findings. Render build installs development dependencies, so the compiler issue still
needs a reviewed dependency fix or explicit risk decision before publication; no automatic compiler upgrade was applied.

Static checks: TypeScript passes. `forge lint` exits 0 with timestamp-comparison warnings for protocol deadlines and unsafe
cast warnings for sourceChainId to uint64 and two test deadline casts. These are retained findings. Sepolia chain ID fits
uint64, and fixed test times fit the test casts; arbitrary-chain support is not claimed. Deadline tests and fuzz checks pass,
but they do not remove validator timestamp influence or constitute an independent audit. Direct compilation also reports
the existing unused queryId parameter warning in PrizeRailASC.

## 10. Remaining blockers and next action

Publication blockers: missing usable Git metadata/reviewable staged diff and unresolved development-toolchain advisories.
Submission/UX hardening: default demo UNKNOWN, historical worker source-hash mismatch after preparation changes, mobile
overview overflow, and unobserved real-wallet/current-runtime E2E. Deployment-specific checks remain pending: actual paid
plan/disk selection, hostnames/CORS, secure worker secret provisioning, public health/assets and persistent restart.

Next action: review this report and inventory, then resolve the compiler advisory and prepare an authorized fresh Git checkout
for a full staged-patch review. Do not deploy or send transactions until separately authorized. A clean inventory or local
test pass is not public deployment or protocol E2E evidence.

## 11. Files changed and durable handoff

Edited: `.env.example`, `.gitignore`, `package.json`, `vercel.json`, `scripts/api.ts`, `scripts/worker.ts`,
`scripts/frontend-build.mjs`, `scripts/frontend-dev.mjs`, `src/api.ts`, `src/worker-runtime.ts`, `test/api-http.test.ts`,
`docs/API.md`, `docs/PUBLIC-DEPLOYMENT.md`, `research/ENVIRONMENT-CONTRACT.md`, `CURRENT-TASK.md`, `PROJECT-STATE.md`.

Added: `scripts/start-render.mjs`, `scripts/publication-scan.mjs`, `test/render-startup.test.ts`,
`test/frontend-packaging.test.mjs`, `docs/PUBLIC-ENVIRONMENT.md`, `docs/PUBLICATION-AUDIT.md`,
`docs/PUBLIC-PREPARATION-REPORT.md`, `docs/PUBLICATION-FILES.txt`.

Package dependency versions and package-lock were unchanged. Solidity contracts and immutable evidence were unchanged.
Generated compiler/static output changed locally and remains ignored. Git status/diff could not be used before or after edits;
the absence of metadata is the documented exception to the repository Git-review rule.

Environment handoff: tests used isolated /tmp directories and loopback ports; no production service is needed to inspect the
source. The original .env and .data remain private and untouched. Node 22 and Gitleaks were installed only into a temporary
audit directory after checking release SHA-256 sums. Test tools and temporary journals are not publication candidates.
The development listener and smoke-test processes were stopped; a final read-only process check found no matching API,
worker, supervisor, frontend-dev or browser-smoke Node processes. Temporary test directories were retained for inspection.
No public service or new blockchain transaction exists from this preparation. Deferred: commits/pushes, deployments, live
writes, contract/protocol changes, full wallet E2E, unrelated UI redesign and automatic dependency upgrades.
