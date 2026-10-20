# API Contract

The local MVP now implements a read-only `/api/v1` worker/API surface. This document remains the compatibility and planning
reference for future hosted deployment or authenticated mutations; it does not claim that those deferred surfaces exist.
The concrete local response envelope and route behavior are documented in [`docs/API.md`](../docs/API.md).

## Conventions

- Base path: `/api/v1`.
- Addresses and hashes are lowercase `0x` hex strings when returned.
- Amounts are decimal strings in token base units.
- Times are ISO-8601 UTC strings.
- Read endpoints require no secret. No mutation or authentication endpoint is enabled in the local MVP.
- Any future mutation endpoint must preserve contract authorization, idempotency, and explicit abuse controls; it is out of scope for the current worker/API.

## Endpoints

### `GET /api/v1/health`

Returns sanitized API, persistence, source/destination RPC, ChainInfo, proof-service, and worker-loop outcomes. A non-`PASS`
dependency is preserved as `UNKNOWN` or `FAIL` and returns HTTP `503`.

### `GET /api/v1/config`

Returns public chain IDs, RPC display names, explorer bases, contract addresses, expected Attestcoin chain key, and feature flags. Never returns private RPC credentials or keys.

### `GET /api/v1/tournaments/{tournamentId}`

Returns policy, funding, source registry, rules hash, deadlines, contract state, result evidence, and claim status.

Tournament creation, funding, result finalization, claim, and refund are direct wallet/contract transactions in the MVP. They intentionally do not depend on a privileged REST mutation endpoint.

### `POST /api/v1/proof-jobs` (not enabled)

Request:

```json
{"tournamentId":"0x…","sourceTxHash":"0x…"}
```

The local MVP is watcher-driven and exposes no mutation route. A future implementation may create or return an idempotent job
keyed by source chain + transaction hash, but callers cannot currently enqueue work over HTTP.

### `GET /api/v1/proof-jobs/{jobId}`

Returns:

```json
{
  "schemaVersion":1,
  "dataMode":"LIVE",
  "outcome":"UNKNOWN",
  "jobId":"job-…",
  "productState":"AWAITING_ATTESTATION",
  "policyState":"FUNDED",
  "jobState":"AWAITING_ATTESTATION",
  "source":{"chainId":11155111,"chainKey":1,"transactionHash":"0x…","blockNumber":123},
  "attestcoin":{"proofStatus":"PENDING","headerNumber":null,"digest":null,"rawProof":null},
  "settlement":{"transactionHash":null,"receiptStatus":null},
  "payout":{"transactionHash":null,"receiptStatus":null},
  "retry":{"attempts":1,"retries":0,"nextRetryAt":"2026-09-08T12:00:00Z"},
  "error":{"class":"PROVER_UNAVAILABLE","message":"proof service is not ready"}
}
```

The fields above are representative; the complete normalized envelope is defined in [`docs/API.md`](../docs/API.md), and
unavailable values are represented as `null` or `UNKNOWN` rather than inferred success.

### `GET /api/v1/tournaments/{tournamentId}/evidence`

Returns the read-only evidence bundle: deployment manifest reference, source/settlement/claim hashes, decoded event, predicate results, replay key/digest, lifecycle timestamps, and explorer URLs.

### `POST /api/v1/auth/challenge` and `POST /api/v1/auth/verify` (not enabled)

Reserved for a future authenticated administrative surface. Smart-contract authorization remains authoritative.

## Error taxonomy

- `INVALID_CONFIGURATION` / `INVALID_INPUT`: startup or boundary validation failure.
- `SOURCE_NOT_FOUND` / `RPC_UNAVAILABLE` / `PERSISTENCE_FAILURE`: unavailable infrastructure; preserve `UNKNOWN` and retry
  where the operation is safe.
- `SOURCE_FAILED`: source receipt status is not successful; terminal `FAIL`.
- `WRONG_SOURCE_CHAIN`, `WRONG_SOURCE_REGISTRY`, `WRONG_EVENT`, `WRONG_TOURNAMENT`, `WRONG_RULES`, `WRONG_WINNER`,
  `INVALID_NONCE`, or `INVALID_RESULT`: permanent semantic mismatch; terminal `FAIL`.
- `POLICY_NOT_FOUND` / `POLICY_NOT_FUNDED`: admission is deferred and remains retryable.
- `POLICY_EXPIRED` / `POLICY_REFUNDED` / `ALREADY_SETTLED`: policy state prevents a new settlement; terminal or reconciliation
  state as described by the live envelope.
- `AWAITING_ATTESTATION`: lifecycle state, not an error; proof retrieval remains pending.
- `PROVER_UNAVAILABLE`: retryable `UNKNOWN` while the hosted proof service is unavailable.
- `MALFORMED_PROOF` / `PROOF_REJECTED` / `SEMANTIC_REJECTION`: terminal proof or settlement failure.
- `REPLAYED`: source/business/query replay was detected; terminal `REPLAY_REJECTED`.
- `WRONG_*` and other semantic classes are never collapsed into infrastructure `UNKNOWN`.

## Idempotency and limits

- The watcher deduplicates source and business identities in a durable single-host journal and uses expiring leases plus
  on-chain replay checks.
- If a future mutation endpoint is added, duplicate requests must return the existing job and rate limiting must protect
  availability without altering correctness.
- Raw proof bytes are omitted from default API responses and may be stored by digest/reference because payloads can be large.
