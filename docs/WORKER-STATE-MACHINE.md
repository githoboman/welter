# Worker State Machine

The journal stores one state per source transaction. The source transaction is the primary identity; `(tournamentId, resultNonce)` is the business uniqueness boundary.

```text
MINED -> WAITING_FOR_POLICY -> AWAITING_ATTESTATION
       -> PROOF_PREFLIGHT_PASS -> SUBMITTING -> SETTLEMENT_PENDING
       -> SETTLEMENT_COMPLETE / CLAIMABLE -> PAYOUT_PENDING -> CLAIMED
```

Terminal branches are `NON_PAYABLE_RESULT`, `VERIFICATION_FAILED`, `PROOF_PREFLIGHT_FAIL`, `REPLAY_REJECTED`, `REFUNDED`, `CLAIMED`, and `ALREADY_SETTLED`. `INFRASTRUCTURE_UNAVAILABLE` and `UNKNOWN` retain the job and a bounded retry timestamp.

| Worker state | Frontend/product meaning |
|---|---|
| `MINED` | Successful source receipt and exact `MatchFinalized` event are recorded. |
| `WAITING_FOR_POLICY` | Result is durable but policy is absent or still `DRAFT`; no proof request is made. |
| `AWAITING_ATTESTATION` | Hosted proof wait is active. |
| `PROOF_PREFLIGHT_PASS` | CC3 native Block Prover accepted the proof. |
| `SETTLEMENT_PENDING` | A CC3 hash exists; receipt/policy reconciliation is pending. |
| `SETTLEMENT_COMPLETE` / `CLAIMABLE` | Receipt and `ResultVerified`/policy state establish claimability. |
| `PAYOUT_PENDING` | Automatic claim was submitted or observed but not reconciled. |
| `CLAIMED` | Policy is `CLAIMED` and a successful payout receipt was observed. |
| `INFRASTRUCTURE_UNAVAILABLE` | Retryable `UNKNOWN`, never a semantic failure. |

Backoff is exponential from 15 seconds, capped at 15 minutes, and bounded by `WORKER_MAX_ATTEMPTS`. A wait timeout never creates a replacement transaction: the persisted hash is checked first.
