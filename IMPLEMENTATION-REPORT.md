# PrizeRail Implementation Report

## Outcome

The historical protocol milestone remains intact. The minimal durable worker/read API is implemented locally with deployment binding, bounded watcher discovery, policy admission, append-only persistence, leases, Attestcoin proof/preflight reuse, settlement/payout reconciliation, and browser-safe status/evidence routes. The preserved worker-driven testnet artifact, `evidence/worker-live-2026-09-11T22-00-53-430Z.json`, records restart/resume, payout reconciliation, and mined replay rejection as historical evidence generated before the stricter journal invariant. Its corresponding journal contains a pre-hardening snapshot that clears an assigned settlement hash, so current code fails closed when reopening it. Current-code restart/reconciliation evidence is closed by the fresh v2 artifact [`evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json`](evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json), with details in [`docs/DURABLE-WORKER-API-CLOSURE-REPORT.md`](docs/DURABLE-WORKER-API-CLOSURE-REPORT.md).

## Implemented files

- `contracts/source/TournamentResultRegistry.sol`: deterministic commit/reveal RPS and canonical `MatchFinalized` event.
- `contracts/creditcoin/PrizeVault.sol`: immutable tournament policy, ERC-20 reserve, settlement, claim, refund, and state machine.
- `contracts/creditcoin/PrizeRailASC.sol`: native proof verification, event/business predicates, and replay domains.
- `src/adapter.ts`: source adapter contract and RPS adapter boundary.
- `src/attestcoin.ts`: official USC SDK proof and CC3 precompile integration.
- `scripts/live-e2e.ts`, `scripts/complete-live-run.ts`, `scripts/attestcoin-probe.ts`, and verification scripts.
- `test/`: Foundry unit, fuzz, authorization, accounting, timeout, and negative-path tests.
- `src/worker-types.ts`, `src/durable-store.ts`, `src/worker-runtime.ts`: live job schema, fsynced journal, scanner, admission, proof, retry, lease, settlement, payout, and reconciliation logic.
- `src/api.ts`, `scripts/api.ts`, `scripts/worker.ts`: read-only `/api/v1` service and worker entrypoints.
- `test/worker.test.ts`: restart persistence, normalized uniqueness lookup, immutable-identity/index-collision checks, lease recovery, API redaction, timeout reconciliation, malformed-input handling, event binding, and terminal-state tests.
- `docs/WORKER.md`, `docs/API.md`, `docs/WORKER-STATE-MACHINE.md`, `docs/OPERATIONS.md`: operational contract and limitations.

Detailed behavior is documented in [`research/IMPLEMENTED-ARCHITECTURE.md`](research/IMPLEMENTED-ARCHITECTURE.md).
Security checks and residual risk are recorded in [`research/SECURITY-VERIFICATION.md`](research/SECURITY-VERIFICATION.md).

## Frontend readiness sprint

The browser SPA now has a real, narrowly scoped organizer path at `/app/launch`. It validates the connected EIP-1193 wallet
and fixed post-fix deployment bindings, reads token balance/decimals/allowance and policy state, and requests only the deployed
`createTournament`, `approve` when needed, and `fund` calls. Receipt status, expected vault events, policy state, transaction
hashes, and timeout reconciliation are rendered explicitly. It never calls the public test-token mint, accepts a payout
recipient, chooses a winner, or submits proof. The route/action audit and verification record are in
[`docs/FRONTEND-READINESS-REPORT.md`](docs/FRONTEND-READINESS-REPORT.md).

Local browser/API smoke and all listed automated checks pass. A real wallet extension and live browser transaction remain
`NOT_TESTED`; no public frontend/API URL exists, so deployment and public E2E are `NOT_DEPLOYED`/not claimed. The durable
deployment boundary, HTTPS/CORS requirements, and persistent journal requirement are in
[`docs/PUBLIC-DEPLOYMENT.md`](docs/PUBLIC-DEPLOYMENT.md).

## Historical and post-fix deployments

- Sepolia registry: `0x83Dfc7fbbd949441Cdc7f8b1eD2D916d059e764D`
- CC3 token: `0x95672dB433fBD38Dd8d70b93081DC1275EFF1b48`
- CC3 vault: `0x802c21a0093a9516D2FD26406F3e16b0E0D1e6F2`
- CC3 ASC: `0xAB51f91396f66FeED1d8b289643Ac58EF3590292`

The manifest, deployment transactions, blocks, compiler settings, and superseded-duplicate note are in [`evidence/live-deployment.json`](evidence/live-deployment.json).

Post-fix v2: source registry `0xDdDA859AC766E3eaE59Dc7b7B85465610aF90a3f`, token `0x9366e8298799A132D20F51021d6Ef3A99D57817C`, vault `0x270B97d063668d9B2107d15E08a81Af2318E7edC`, ASC `0xD5226c2eC2C6958A9785C29DADBc28810f718CCf`. The versioned manifest is `evidence/post-fix-deployment-2026-09-10T02-43-34-178Z.json`; `evidence/current-deployment.json` selects it for current scripts.

## Live evidence

The three complete runs and the explicitly excluded partial attempt are recorded in [`research/E2E-RUN-LOG.md`](research/E2E-RUN-LOG.md). The latest run is `live-ab26885f`:

- source `MatchFinalized`: `0x7f2de354984d134aa7c46f87fc7149839e8c2b5d17c048cb688333e1548bd0af`
- settlement: `0x4dfb73eaa0108563a5e0174de10a3aa60a8057f5c8dec5e4d83ad5e780260e01`
- payout: `0x31c728d0961cc6697f037364c8014966a7222328e451f8ab7fda7907ef969c34`
- replay rejection: `0x4e9d46cc9216ea7735f3c7fdd920b45a47e3a3c1c2aefc46d3f8bba745b3ad7e` (status `0`)
- proof header: `11670146`; winner balance after claim: `4 PRIZE`

Post-fix run `live-f99b1968`: source `0x9629ae21376cfad615c49c65b2fab76a7522ca4170da0d6edcbf25369bff42a6`, settlement `0x30b549ed395700eefbb69ea924b767c15639d12378ff000c69cf1c66ca0a9119`, payout `0xf0b5dda8f92005386313576a3ff58628baf856888b4f7e62f4b60474021818a3`, replay `0x02b5d771147076537c9d985ff2c2f225988976ab12c7cab61f08872abe0b5d7b`. Recovery evidence: `0x06e79fe69ab8e68c2ec30cf93d89454c3ec7d7a211366161604d9ceab99a9c7d`.

The retained `evidence/live-28e7fb00.json` is an intermediate pre-materialization record for the worker job, with a timed-out replay attempt and no replay transaction hash; it is superseded by the preserved worker artifact and is not counted as a complete run. The older worker artifact is historical evidence; the fresh v2 artifact is the current-code restart/reconciliation closure artifact.

## Verification commands

```bash
npm run typecheck
forge build
forge test -vvv
npm run compile:direct
npm run verify:adapter
npm run verify:evidence -- evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json
npm run verify:evidence -- evidence/local-e2e-run-1.json
npm run verify:demo
npm run verify:proof -- <evidence-file>
npm run verify:recovery -- evidence/recovery-f620cf7d.json
npm run verify:tamper -- evidence/live-2026-09-10T02-44-30-530Z.json
npm run worker:test
```

Live operations:

```bash
npm run live:preflight
npm run live:e2e
npm run live:complete -- <MatchFinalized-tx-hash>
npm run attestcoin:probe -- <source-tx-hash>
npm run api
npm run worker
```

`verify:demo` performs read-only public-RPC checks and requires no private credential. With no `.env`, it defaults to keyless Sepolia `https://ethereum-sepolia-rpc.publicnode.com` and CC3 `https://rpc.cc3-testnet.creditcoin.network`. It reports `PASS`, `FAIL`, or `UNKNOWN`; it never writes on-chain state.

The local three-run recorder writes `research/LOCAL-E2E-RUN-LOG.md`; it does not overwrite the canonical live run log.

## Verified versus unverified

Verified: historical source/Attestcoin/CC3/payout/replay evidence; fresh current-code worker discovery through claim and restart during delayed proof acquisition; worker/API TypeScript typecheck and 61 focused worker tests; durable journal restart on valid records; normalized source/business lookup reconstruction; immutable job identity, source mismatch, and tournament-only collision rejection; lock-owner preservation; expiring lease recovery; uncertain-submission recovery; fresh-policy/deadline/API projection checks; raw-proof omission from API responses; and existing frontend/contract verification commands where recorded below. Unverified: reopening the canonical pre-hardening worker journal with current code, hosted API deployment, production security audit/storage/custody, arbitrary adapters, real-value tokens, README/submission package, deck/video, secret-scan artifact, and Attestcoin writability.

Frontend-readiness contracts now include post-fix recovery and reveal ordering. The local browser API/wallet integration is
wired and verified for read-only behavior and pre-write guards; hosted service deployment and real extension transaction
evidence remain open.

### Journal compatibility closure

The journal schema remains version `1`, but that version does not guarantee compatibility with pre-hardening v1 records. A historical record that clears an assigned settlement or payout transaction hash is rejected as an immutable-identity mutation; current code fails closed rather than rewriting it. No migration tool currently exists. Operators must preserve incompatible journals read-only and use a fresh data directory, or conduct a separately reviewed migration reconstructed from on-chain evidence.
