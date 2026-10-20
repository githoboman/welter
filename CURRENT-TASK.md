# Current Task

Current phase (2026-09-13): public deployment preparation and publication audit, with no commit, push, deployment or live
blockchain write authorized. See [docs/PUBLIC-PREPARATION-REPORT.md](docs/PUBLIC-PREPARATION-REPORT.md) for the current
implementation changes, validation results, exact deployment settings, local-only files and remaining blockers.
The local directory has no usable Git metadata; the supplied target is the currently empty unifyWeb3/prizerail repository.
The historical worker milestone below predates these preparation source changes and is not current-source-hash verification.

## Previous milestone context

Protocol reliability hardening and the durable worker/read API milestone are implemented and live-demonstrated on the versioned post-fix deployment:

`both commits -> reveals -> deterministic source result -> real Attestcoin proof -> CC3 settlement -> payout -> replay rejection`, plus permissionless expired-policy recovery to the immutable organizer.

Historical evidence remains immutable. The minimal durable worker/read API is implemented with bounded source discovery,
policy admission, append-only journal persistence, leases, Attestcoin proof/preflight reuse, settlement/payout
reconciliation, and read-only `/api/v1` routes. Deterministic worker tests pass. The preserved worker-driven
Sepolia-to-CC3 artifact is historical evidence generated before the stricter journal invariant; its pre-hardening
journal cannot be reopened by current code because a retry snapshot clears an assigned settlement hash. A fresh
post-hardening run with a new data directory was required before claiming current-code restart/reconciliation evidence or
closing the worker/API milestone. The fresh current-code run and independent verifiers now satisfy this requirement; the
historical journal remains read-only and incompatible. See `docs/DURABLE-WORKER-API-CLOSURE-REPORT.md`.
