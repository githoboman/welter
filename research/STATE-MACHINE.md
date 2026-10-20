# State Machine

## On-chain tournament state

```text
DRAFT --fund full prize--> FUNDED --valid proof--> CLAIMABLE --claimFor--> CLAIMED
                              |
                              +--settlement deadline passes, before refund deadline--> REFUNDED (via organizer refund)
                              +--refund deadline passes--> REFUNDED (via permissionless recoverExpired; organizer beneficiary)
```

Terminal states: `CLAIMED` and `REFUNDED`. A valid proof cannot revive a refunded/recovered tournament; after `refundDeadline`, anyone may trigger recovery but the beneficiary remains the frozen organizer.

| Current | Trigger | Guards | Next | Effect |
|---|---|---|---|---|
| DRAFT | fund | correct token/amount, before funding deadline | FUNDED | lock prize |
| FUNDED | verify result | proof + semantic checks pass, before settlement deadline, unused keys | CLAIMABLE | bind winner, consume replay keys |
| FUNDED | deadline passes | no settlement, after settlement deadline and at or before refund deadline | REFUNDED | organizer receives reserved prize |
| FUNDED | `recoverExpired` | after refund deadline, still funded | REFUNDED | trigger is permissionless; immutable organizer receives reserve |
| CLAIMABLE | `claimFor` | unclaimed | CLAIMED | transfer prize to frozen winner; any caller may trigger |

## Proof-job state

```text
RECEIVED -> SOURCE_CONFIRMED -> AWAITING_ATTESTATION -> PROOF_READY
        -> PREFLIGHTED -> SUBMITTING -> SETTLED

Any infrastructure step -> UNKNOWN_RETRYABLE -> previous safe step
Any semantic/proof failure -> FAILED_TERMINAL
Already consumed -> REPLAYED_TERMINAL
```

`UNKNOWN_RETRYABLE` is not proof failure. It captures RPC/prover timeouts, temporary disagreement, or unavailable attestation. The UI must not flatten it into failure or success.

## Concurrency rules

- Database job creation is unique on source chain + transaction hash.
- A renewable lease permits one worker submission attempt at a time.
- On-chain replay keys are the final concurrency control.
- If a submission times out, query the chain before retrying.

## Failure recovery

- Browser refresh resumes from job ID or source transaction hash (when a future UI/API is deployed).
- Worker restart reloads non-terminal jobs.
- Database loss is recoverable by scanning project contract events and source/settlement hashes in the evidence manifest.
