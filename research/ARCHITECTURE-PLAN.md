# Architecture Plan

## System boundary

```text
Operator wallet
     |
     v
Sepolia TournamentResultRegistry -- receipt/log --> proof worker --> hosted ProofBuilder
                                                                  |
                                                                  v
Winner wallet --> web app/API --> Creditcoin PrizeRailASC --> 0x0FD2 Block Prover
                                      |                    --> 0x0FD3 ChainInfo
                                      v
                                  PrizeVault --> claim/refund

Worker/API <--> relational job/evidence store
All on-chain state --> explorer/read-only verifier
```

## Components

### Source contract

Minimal deterministic commit/reveal RPS registry with one authorized finalizer for match creation, permissionless finalization after both reveals or the deadline, immutable match identifiers/participants/rules/deadline, one derived result, and a structured event. The finalizer cannot pass an arbitrary winner to `finalize`. It is intentionally not a general tournament engine or anti-cheat system.

### Creditcoin verification contract

Accepts the Attestcoin proof payload, invokes the native verifier, obtains proven transaction/receipt data, decodes only the expected result event, checks every business predicate, computes replay keys, and atomically calls the vault.

### Creditcoin vault

Owns policies and funds. Verification and accounting are separated so proof parsing cannot silently mutate money outside the vault’s narrow interface.

### Worker

An availability component, not a trust component. It normalizes source events, waits for attestation, gets/preflights proofs, submits transactions, and stores evidence. Anyone should be able to submit a valid proof if the contracts permit it.

### Web/API

The browser signs user transactions. The API exposes status and can enqueue a proof job. A server-side relayer key is optional; if used, it may pay only for proof submission and receives no authority over settlement outcome.

## Data model

- `tournaments`: ID, organizer, source registry, rules hash, prize token/amount, deadlines, state.
- `proof_jobs`: source tx, source block, state, attempt count, error class, proof digest, settlement tx.
- `evidence`: decoded fields, pass/fail/unknown checks, explorer URLs, timestamps.
- On-chain state remains authoritative; database rows are cached operational state.

## Availability and trust

- Hosted RPC/prover outage delays settlement but cannot forge it.
- Database loss must be recoverable from transaction hash, contract events, and deployment manifest.
- Frontend compromise can mislead presentation but cannot bypass contract validation.
- Source finalizer compromise can create a misleading match or omit a match, even though the winner of an existing match is derived from commits/reveals; this is explicit and requires application-level governance/multisig in production.

## Architecture decision records

1. Readability only for MVP; writability is not mature enough to be load-bearing based on inspected documentation.
2. Pull claims reduce settlement reentrancy and failed-recipient risk.
3. Worker state is resumable and idempotent because attestation is asynchronous.
4. Receipt/event semantic checks stay on-chain because off-chain checks are not authoritative.
5. One supported source in MVP prevents generic decoder complexity.
