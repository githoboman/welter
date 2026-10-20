# PrizeRail API

The API is read-only and versioned at `/api/v1`. It never accepts contract addresses, chain IDs, proof bytes, or payout recipients from callers, and it never submits a transaction as a side effect of `GET`.

## Routes

| Route | Meaning |
|---|---|
| `GET /api/v1/live` | API process liveness only (`scope: API_PROCESS_ONLY`). Render health check; no claim about worker/RPC/prover readiness. Invalid startup configuration still returns 503. |
| `GET /api/v1/health` | Sanitized API, journal, RPC, ChainInfo, proof-service, and worker-loop readiness. HTTP `503` means `FAIL` or `UNKNOWN`; the body preserves the individual outcomes. |
| `GET /api/v1/config` | Public selected deployment, chain IDs, explorer bases, addresses, expected precompiles, and feature flags. No secrets or balances. |
| `GET /api/v1/tournaments/:tournamentId` | Current policy read plus matching durable job, if discovered. |
| `GET /api/v1/tournaments/:tournamentId/status` | Stable live status envelope. |
| `GET /api/v1/tournaments/:tournamentId/evidence` | Stable live evidence envelope plus normalized policy fields. |
| `GET /api/v1/proof-jobs/:jobId` | Durable job status and evidence. |

Tournament IDs must be lowercase `0x` plus 64 hexadecimal characters. Unknown IDs are not converted into historical evidence. A missing policy/job is represented as `UNKNOWN` or a policy-derived state. Historical JSON files are never loaded by live routes.

## Response envelope

Every status/evidence response contains `schemaVersion: 1`, `dataMode: "LIVE"`, `outcome` (`PASS`, `FAIL`, or `UNKNOWN`), `productState`, `policyState`, `jobState`, source data, Attestcoin metadata, settlement/payout metadata, replay/refund evidence, explorer links, UTC timestamps, retry/lease metadata, and a normalized error. Hashes and addresses are lowercase; amounts and nonces are decimal strings; unavailable values are `null` or `UNKNOWN`. `attestcoin.rawProof` is always `null`.

`/config` exposes only public deployment facts. Dependency readiness is reported by `/health`, not inferred from `/config`.

## Error taxonomy

Transient RPC, ChainInfo, prover, receipt, and persistence uncertainty is `UNKNOWN` with a retry timestamp. An internally inconsistent `CLAIMED` journal record without a successful payout receipt and `PrizeClaimed` event is also downgraded to `UNKNOWN` until reconciliation completes. Semantic errors such as wrong registry/rules/winner, invalid result, failed source receipt, expiry, replay, malformed proof, or mined settlement failure are `FAIL` and terminal. No route mutates chain state; unsupported methods return `405`.

## Start

```bash
npm run api
```

`PORT` defaults to `3000`; `HOST` defaults to `127.0.0.1`. `CORS_ALLOWED_ORIGINS` is an explicit comma-separated allowlist; an empty value emits no cross-origin grant.
