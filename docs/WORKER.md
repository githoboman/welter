# PrizeRail Worker

The worker is a server-only availability coordinator. The source registry, Attestcoin native verifier, ASC, and vault remain the correctness authorities.

## Runtime

`src/worker-runtime.ts` loads `evidence/current-deployment.json`, resolves its versioned post-fix manifest, and fails closed on network, address, source-finalizer, settlement-authority, ASC-vault, expected-chain-key, Block Prover, or ChainInfo mismatch. It scans only the selected Sepolia registry, from `WORKER_SOURCE_START_BLOCK` (default: the selected deployment block), in bounded batches. The cursor is journaled and a small rewind (`WORKER_REORG_REWIND`) is rescanned on each pass. A failed range read or undecodable receipt does not advance the cursor.

For each successful `MatchFinalized` receipt, the worker persists the decoded source result before policy admission. Admission requires a matching funded CC3 policy, selected chain key/registry, rules hash, payable winner/result, unused replay keys, and an unexpired settlement deadline. Missing/unfunded policies remain durable `WAITING_FOR_POLICY` jobs and are retried; draws, refunded policies, replay, semantic mismatch, and expiry are terminal classifications.

The proof path calls the existing `getAttestcoinProof` and `proofToQuery` implementation. Raw proof bytes remain in memory only. The worker records header, digest, cache flag, and native preflight outcome, then submits `PrizeRailASC.verifyAndSettle`. It stores a transaction hash before waiting, and reconciles receipt, events, policy state, and replay mappings before any possible retry. Automatic `claimFor(tournamentId)` is disabled by default and is enabled only with `WORKER_AUTO_CLAIM=true`; it never accepts a payout recipient.

## Durable store

`src/durable-store.ts` uses an append-only `worker.journal` under `PRIZERAIL_DATA_DIR` (default `.data/prizerail`). Each line is fsynced before acknowledgement. A lock file serializes writers across processes, reloads the journal while locked, removes only stale locks, and has a corruption fail-closed path. A trailing partial line is treated as a crash tail. Records include schema version, cursor, observations, complete job snapshots, and state transitions. Source `(chainId, transactionHash)`, tournament, business `(tournamentId, resultNonce)`, settlement-transaction, and payout-transaction indexes are rebuilt on restart with normalized lowercase keys.

The journal schema remains version `1`, but the version alone does not guarantee compatibility with pre-hardening v1 records. Existing records are replayed through the same normalized-key and immutability checks; a record that clears or changes an assigned settlement/payout hash, or otherwise violates the stricter invariants, fails closed instead of being silently repaired. No migration tool currently exists. Preserve an incompatible historical journal read-only and start with a fresh data directory; a migration, if needed, must be separately reviewed and reconstructed from on-chain evidence. A job's source/business/tournament identity and an assigned settlement or payout hash are immutable. Index collisions, disagreement between source/tournament/business owners, unsupported schema versions, and malformed complete records fail closed. A writer holding a lease must persist the same lease owner; an expired or mismatched lease is rejected with `LEASE_LOST`. Treat a journal that fails these checks as corrupt and preserve it for investigation before starting a new data directory.

Leases include an owner and expiry, are renewed during proof/transaction work, and are released on completion. An expired lease can be acquired by a restarted worker. A submitted settlement or payout hash is always reconciled before retry/backoff decisions.

Run the process with:

```bash
npm run worker
```

The worker requires `WORKER_PRIVATE_KEY` for settlement and will not start a write-capable loop without it. Use `npm run api` for the read API; the API can run without a worker key and reports that write readiness is unavailable.

## Deliberate limitations

This is a single-process polling worker with a file journal, not a horizontally coordinated production queue. Reorg handling is limited to the configured rewind window. Hosted prover latency is unbounded from the HTTP perspective. The preserved worker-driven run in `evidence/worker-live-2026-09-11T22-00-53-430Z.json` demonstrates restart while awaiting proof, timeout reconciliation, one settlement, one payout, and replay rejection as historical pre-hardening evidence. Current-code restart/reconciliation closure is recorded in [`evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json`](../evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json). The worker/API remain local and single-host; hosted deployment and managed storage are deferred.
