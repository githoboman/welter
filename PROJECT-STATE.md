# Project State

Deployment-preparation update (2026-09-13): the API/worker supervisor, persistent storage configuration, and explicit static
evidence packaging are prepared locally. Publication readiness remains FAIL; the target unifyWeb3/prizerail is empty and this
directory has no usable Git metadata. The current report and handoff is
[docs/PUBLIC-PREPARATION-REPORT.md](docs/PUBLIC-PREPARATION-REPORT.md). Its findings supersede any implication below that the
historical worker artifact verifies the source hashes after these preparation changes. No new public deployment or E2E run
has been performed.

Status: protocol reliability hardening and the durable worker/read API milestone are complete for the local testnet path. The preserved historical worker journal still predates the stricter immutable-hash invariant and fails closed on reopen; current-code closure is established by the fresh v2 artifact and report in `docs/DURABLE-WORKER-API-CLOSURE-REPORT.md`.

The historical deployment has three complete live Sepolia -> Attestcoin -> CC3 runs with real proof preflight, CC3 semantic settlement, winner payout, and mined replay rejection. The historical latest evidence is `evidence/live-latest.json`; `npm run verify:demo` performs read-only public-RPC checks without private credentials.

A separate post-fix `v2` deployment and live runs now demonstrate both-commitments-before-reveal, funded-state recovery, settlement, payout, and replay protection. Its manifest is selected by `evidence/current-deployment.json`; `evidence/live-latest.json` intentionally remains the historical third-run pointer, while the post-fix and worker artifacts are recorded separately. The earlier worker artifact is historical pre-hardening evidence; current-code restart/reconciliation closure is the fresh run `evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json`.

The frontend-readiness source of truth is now:

- [`docs/FRONTEND-CONTRACT.md`](docs/FRONTEND-CONTRACT.md)
- [`docs/FRONTEND-STATE-MODEL.md`](docs/FRONTEND-STATE-MODEL.md)
- [`docs/API-GAP-AUDIT.md`](docs/API-GAP-AUDIT.md)
- [`docs/EVIDENCE-UX-CONTRACT.md`](docs/EVIDENCE-UX-CONTRACT.md)
- [`docs/DEMO-FLOW-CONTRACT.md`](docs/DEMO-FLOW-CONTRACT.md)
- [`docs/BACKEND-FREEZE.md`](docs/BACKEND-FREEZE.md)
- [`docs/FRONTEND-READINESS-REPORT.md`](docs/FRONTEND-READINESS-REPORT.md)

Selected post-fix addresses and deployment provenance are in `evidence/current-deployment.json` and its versioned manifest. The historical three-run deployment remains in `evidence/live-deployment.json` and must be treated as historical only.

Current limits that affect product truth: `finalize` is permissionless after both reveals or after the deadline; the vault/ASC has no global source-registry allowlist; historical runs conflate wallet roles; the post-fix run uses explicit role configuration but reuses the two funded wallets; and the standard public verifier checks recorded Attestcoin preflight evidence. Optional `verify:proof` reconstructs proof bytes read-only when the hosted prover is available and otherwise returns `UNKNOWN`.

The source authority limitation is intentional: PrizeRail proves and settles the result recorded by the source game; it does not detect off-chain cheating or prove organizer honesty.

Environment: live write scripts and `npm run worker` require server-only `.env` values and a funded worker wallet; `npm run api` exposes a read-only `/api/v1`. The worker uses a fsynced append-only journal under `.data/prizerail`, bounded source scanning, expiring leases, backoff, and receipt/policy reconciliation. The preserved pre-hardening artifact remains historical/read-only; current-code evidence is the v2 worker artifact above, and the service remains local-only.

Frontend now exists under `frontend/` as a browser SPA with typed historical-evidence and deployment repositories, responsive
app shell, evidence archive, activity ledger, role/configuration surface, live worker/API reads, EIP-1193 wallet observation,
and an organizer create/approve/fund flow. The browser write path is implemented but not demonstrated with a real extension or
live transaction, and it does not expose raw proof bytes or fabricate current-wallet balances.

Deferred scope: hosted API deployment, real wallet-extension/browser write demonstration, production relational storage/custody/audit,
arbitrary source adapters, real-value prizes, mainnet, submission README/deck/video, and Attestcoin writability.
