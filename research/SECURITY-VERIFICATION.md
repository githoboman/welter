# Security Verification Record

The security checks below include the post-fix deployment and the fresh current-code worker/API hardening run. The preserved worker artifact predates the stricter durable-journal invariant; compatibility of that historical journal is therefore an explicit residual risk and is not treated as closed by the historical evidence.

## Automated checks

- `forge test -vvv`: **32 passed**, including the 256-run vault funds-conservation fuzz test, source normal win/loss/draw/timeout behavior, both-commitments-before-reveal ordering, permissionless guarded finalization, semantic negative paths, replay, claim, normal refund, expired recovery, and authorization checks.
- `npm run typecheck`: **PASS**.
- `npm run worker:test`: **61 passed**, covering normalized source/business idempotency, immutable job identity and index-collision rejection, tournament-only collision rejection, lock-owner preservation, lease fencing/recovery, API redaction and fresh-policy/deadline projections, timeout reconciliation and uncertain-submission recovery, malformed-input handling, event/policy predicate binding, policy admission, malformed journal tails, proof-shape validation, and stale settlement/payout reconciliation.
- `npm run verify:adapter`: **PASS**; the concrete RPS adapter decodes the canonical event and rejects failed receipts/wrong source emitters.
- `npm run verify:evidence`: **PASS** for the local verifier-double evidence bundle.
- `npm run local:e2e:three`: **PASS** with three local runs written to `research/LOCAL-E2E-RUN-LOG.md`; the canonical live log remained unchanged.
- `npm run verify:demo -- evidence/live-2026-09-10T02-44-30-530Z.json`: **PASS** for the post-fix live bundle. The default command still selects the older `evidence/live-latest.json` bundle; its available receipts, events, bindings, payout, and replay evidence validate, but it truthfully returns `overall: UNKNOWN` because that immutable evidence omits `destination.amount`.
- `npm run compile:direct`: **PASS** with Solidity `0.8.28`, optimizer, `viaIR`, and Shanghai EVM.
- `npm run verify:proof:test`: **PASS**; proof digest/header mismatch and native-preflight failure classify as `FAIL`.
- `npm run verify:roles`: **PASS**; explicit role labels, required key resolution, and intentional role-reuse declarations are validated without exposing key material.
- `npm run verify:recovery -- evidence/recovery-f620cf7d.json`: **PASS**; third-party recovery paid the immutable organizer, reached `REFUNDED`, and blocked later settlement.
- `npm run verify:tamper -- evidence/live-2026-09-10T02-44-30-530Z.json`: **PASS**; provable evidence mutations classify as `FAIL` and unavailable public RPCs classify as `UNKNOWN`.
- Manual secret scan: **PASS** for repository source/configuration files after excluding local `.env`, dependencies, generated artifacts, and public evidence hashes; no dedicated secret-scanner binary is installed, so this is not presented as a tool-audit report.
- Post-fix live E2E: **PASS** in `evidence/live-2026-09-10T02-44-30-530Z.json`; live recovery: **PASS** in `evidence/recovery-f620cf7d.json`.
- Fresh durable worker/API run: **PASS** in `evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json`; the artifact records real Sepolia discovery, Attestcoin preflight, CC3 settlement, payout, restart/reconciliation, API redaction, and mined replay rejection.

## Journal compatibility and evidence closure

The canonical worker artifact `evidence/worker-live-2026-09-11T22-00-53-430Z.json` is historical evidence generated before immutable assigned-transaction hashes were enforced. Reopening its journal with current code fails closed at the pre-hardening snapshot that clears a previously recorded settlement hash (`DurableStore.open(".data/worker-2026-09-11T05-40-40-827Z", 1)` reports an immutable job identity mutation). Schema version `1` is unchanged, but it does not guarantee compatibility with those records. No migration tool currently exists. Preserve the historical journal read-only and use a fresh data directory for future runs; any migration must be separately reviewed and reconstructed from on-chain evidence. Current-code restart/reconciliation evidence is closed by the fresh v2 worker/API artifact linked above.

## Secret policy

- `.env` is local-only and ignored by `.gitignore`; it is never read into evidence or logs by the public verifier.
- `.env.example` contains public endpoints, selected deployed addresses, and placeholders only; it contains no private key or provider credential.
- Public evidence JSON contains addresses, hashes, blocks, decoded fields, timing, and explorer URLs only.
- The public verifier performs no writes and uses no private key. With no `.env`, it uses keyless public RPC defaults.

## Residual risk

No independent production contract audit or static-analysis tool report is claimed. The source finalizer authority, hosted prover availability/latency, explicit role reuse in the post-fix live run, test-token value, testnet status, pre-hardening journal compatibility, and deferred hosted worker/browser scope remain documented limitations in `KNOWN-ISSUES.md` and `IMPLEMENTATION-REPORT.md`.
