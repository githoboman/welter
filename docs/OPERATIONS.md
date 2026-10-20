# Worker Operations

## Configuration

1. Copy `.env.example` to a server-only `.env`.
2. Confirm `PRIZERAIL_DEPLOYMENT_MANIFEST=evidence/current-deployment.json` resolves the post-fix manifest.
3. Set a bounded `WORKER_SOURCE_START_BLOCK` before creating a fresh source match.
4. Use a dedicated testnet `WORKER_PRIVATE_KEY` whose address equals the manifest settlement authority.
5. Keep `WORKER_AUTO_CLAIM=false` unless automatic permissionless claim is intentionally being demonstrated.

## Run and inspect

```bash
npm run api
npm run worker
curl http://127.0.0.1:3000/api/v1/health
curl http://127.0.0.1:3000/api/v1/config
```

The API is safe to expose to the browser. The worker, prover URL, keyed RPC URLs, journal, and private key remain server-side. Stop with `SIGINT`/`SIGTERM`; the journal and lease expiry make restart resumable.

## Recovery rules

- On restart, inspect all jobs with submitted settlement/payout hashes before allowing new submissions.
- If a receipt is missing, retain `UNKNOWN` and retry reconciliation; do not resubmit solely because a wait timed out.
- If a mined receipt is status `0`, preserve the failure and stop retrying semantic work.
- If the policy is already `CLAIMABLE`/`CLAIMED`, record the existing state and do not settle again.
- If the policy is `REFUNDED`, expose the terminal refund state.
- If the source range read fails, the cursor remains unchanged.

## Evidence

The journal is the durable operational evidence. Public responses include only proof header/digest/cache/preflight metadata, transaction hashes/receipts, decoded predicates, states, timestamps, and explorer URLs. Raw proof bytes and secrets are never logged, persisted in public evidence, or returned by the API.

The preserved worker-driven artifact `evidence/worker-live-2026-09-11T22-00-53-430Z.json` remains historical pre-hardening evidence and its journal must stay read-only. Current-code restart/reconciliation closure is recorded in [`evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json`](../evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json); see [`docs/DURABLE-WORKER-API-CLOSURE-REPORT.md`](DURABLE-WORKER-API-CLOSURE-REPORT.md). For future runs, reproduce or materialize a completed durable job with `npm run worker:evidence -- <data-directory> <job-id> <replay-hash>` using a fresh data directory, then emit and verify a new v2 artifact. Chain validation is read-only, while the command writes a new evidence file and journal projection. Each file name includes a UTC timestamp, process ID, and random suffix; the temporary file is created exclusively and hard-linked exclusively into place, so an existing historical artifact is never overwritten. A filesystem that does not support hard links causes the command to fail closed rather than fall back to replacement.
