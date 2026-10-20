# Frontend State Model

This model separates authoritative on-chain policy state, source-match progress, proof-worker progress, and transaction observation. The durable worker journal and `/api/v1` expose live job records locally; the preserved pre-hardening worker-driven run remains historical evidence, while current-code restart/reconciliation closure is recorded in the fresh v2 artifact. The SPA can explicitly read local live status/evidence and request organizer create/approve/fund transactions; API hosting, real extension evidence, and browser proof/settlement remain out of scope.

## State layers

### Policy state (authoritative on CC3)

For UI terminology, `TOURNAMENT_CREATED` and `UNFUNDED` both map to the on-chain `DRAFT` state; the policy exists but its reserve has not been transferred.

| Numeric state | Name | Meaning | Allowed next state |
|---:|---|---|---|
| 0 | `DRAFT` | Policy exists but the organizer has not funded the exact token amount. | `FUNDED` by organizer `fund`. |
| 1 | `FUNDED` | Exact reserve is held by the vault and settlement is possible before `settlementDeadline`. | `CLAIMABLE` by valid ASC settlement, or `REFUNDED` by normal refund/recovery. |
| 2 | `CLAIMABLE` | ASC accepted proof and semantic predicates; winner/nonce/source query are frozen. | `CLAIMED` by anyone calling `claimFor`. |
| 3 | `CLAIMED` | Winner payout completed. | terminal. |
| 4 | `REFUNDED` | Organizer received the reserve through normal refund or expired-policy recovery. | terminal. |

There is no contract state named `EXPIRED`. Expiry is a derived UI condition from the current block timestamp, policy state, and deadlines.

### Source match state (derived from `matches(matchId)`)

| UI state | Actual condition | Authority |
|---|---|---|
| `MATCH_PENDING` | No match record yet, or match created with no meaningful progress. | Sepolia registry read. |
| `MATCH_ACTIVE` | Match exists, `finalized == false`; commits/reveals may be partial or complete. | Sepolia registry read and events. |
| `MATCH_FINALIZED` | `finalized == true`; winner/result/status/nonce are frozen. | Sepolia `MatchFinalized` receipt plus `matches`. |
| `MATCH_FINALIZATION_BLOCKED` | `finalized == false`, fewer than two reveals, and current time is not past `revealDeadline`. | Sepolia read. |
| `MATCH_TIMEOUT_FINALIZABLE` | `finalized == false` and current time is past `revealDeadline`. Any caller may finalize. | Sepolia read. |

The finalizer address controls `createMatch`, not `finalize`. Finalization is permissionless after both reveals or after the deadline.

### Proof and settlement state

| UI state | Actual meaning | Current availability |
|---|---|---|
| `MINED` | Source finalization transaction has a successful receipt and a decodable `MatchFinalized` event. | Derivable directly from RPC; script checks it. |
| `AWAITING_ATTESTATION` | Source block is not yet attested or the hosted proof builder is still waiting. | Persisted by the worker/API. |
| `PROOF_READY` | Proof payload returned by hosted builder. | Raw proof remains memory-only; header/digest/cache metadata is persisted. |
| `PROOF_PREFLIGHT_PASS` | CC3 native Block Prover preflight accepted the proof. | Recorded in evidence as `attestation.verified`; not independently reconstructed by the public verifier. |
| `ATTESTATION_VERIFIED` | Alias for `PROOF_PREFLIGHT_PASS` in user-facing copy. It means proof preflight succeeded, not that raw proof bytes are publicly reproducible. | Current evidence and local worker/API expose the recorded check; raw proof remains server-side. |
| `PROOF_PREFLIGHT_FAIL` | Native preflight returned false or proof construction failed. | Persisted terminal `FAIL`; infrastructure outages remain retryable `UNKNOWN`. |
| `SUBMITTING` | CC3 proof submission is beginning; the hash is persisted immediately when returned. | Worker/API journal. |
| `SETTLEMENT_PENDING` | Submission may be mined or may have timed out; policy still needs a chain read. | Worker reconciles the persisted hash before any retry. |
| `SETTLEMENT_COMPLETE` | CC3 receipt status `1`, `ResultVerified` and `TournamentSettled`, policy `CLAIMABLE`. | Verifiable on-chain. |
| `VERIFICATION_FAILED` | Semantic/proof failure such as wrong source, rules, winner, nonce, receipt, or replay. | Decode ASC/vault errors where possible; otherwise `FAIL` with evidence. |
| `NON_PAYABLE_RESULT` | Source match finalized as a draw/unsupported result with no winner; ASC deliberately refuses prize settlement. | Sepolia event plus failed CC3 settlement attempt or source result read. |
| `INFRASTRUCTURE_UNAVAILABLE` | RPC/prover/ChainInfo unavailable or timed out. | `UNKNOWN`, retryable; not a business-invalid result. |

### Payout and refund state

| Requested UI state | Actual mapping |
|---|---|
| `PAYOUT_PENDING` | Policy is `CLAIMABLE` and no successful `PrizeClaimed` receipt is observed. Any caller may submit `claimFor`. |
| `PAYOUT_COMPLETE` | Policy is `CLAIMED` and a matching `PrizeClaimed` receipt/event exists. |
| `REFUND_AVAILABLE` | Policy is `FUNDED`, current time is after `settlementDeadline` and at or before `refundDeadline`, and organizer is connected. |
| `REFUNDED` | Policy is `REFUNDED` and matching `TournamentRefunded` or `TournamentRecovered` evidence exists. |
| `RECOVERY_AVAILABLE` | Policy is still `FUNDED` and current time is after `refundDeadline`; any gas-paying wallet may trigger `recoverExpired`, but only the organizer can receive funds. |
| `ALREADY_SETTLED` | Policy is `CLAIMABLE` or `CLAIMED`; settlement cannot run again. |
| `REPLAY_REJECTED` | A replay attempt has a proven rejected receipt/preflight. This is an attempt result, not a policy state. |
| `UNKNOWN` | Required chain read/receipt/evidence is unavailable or contradictory. |

## End-to-end state sequence

```text
DRAFT
  -> FUNDED
  -> MATCH_PENDING / MATCH_ACTIVE
  -> MATCH_FINALIZED + MINED
  -> AWAITING_ATTESTATION
  -> PROOF_READY
  -> PROOF_PREFLIGHT_PASS
  -> SUBMITTING / SETTLEMENT_PENDING
  -> SETTLEMENT_COMPLETE / CLAIMABLE
  -> PAYOUT_PENDING
  -> PAYOUT_COMPLETE / CLAIMED
  -> REPLAY_REJECTED (separate negative-path attempt)
```

Alternative funded branch:

```text
FUNDED -> REFUND_AVAILABLE -> REFUNDED
FUNDED -> RECOVERY_AVAILABLE -> REFUNDED
```

Invalid or unavailable branches:

```text
MINED -> VERIFICATION_FAILED
AWAITING_ATTESTATION / SUBMITTING -> INFRASTRUCTURE_UNAVAILABLE -> retry previous safe state
```

## Transaction observation rules

1. `PENDING` means a wallet returned a transaction hash but no receipt has been observed. It is not success.
2. `MINED` means receipt status `1` and the expected event/target are present.
3. A receipt status `0` is a mined rejection and must be displayed as `FAIL`/`REPLAY_REJECTED`, not as a successful transaction.
4. An RPC timeout requires a receipt lookup before retry. The frontend must not submit a second transaction solely because the first wait timed out.
5. A missing receipt is `UNKNOWN`; a failed receipt is `FAIL`.
6. State reads after a write must confirm the expected state transition and event binding.

## Historical versus live state

The checked-in JSON files remain completed historical runs and must stay labeled `HISTORICAL_VERIFIED_RUN`. The local API can now expose `LIVE` pending, retry, lease, and outage state with durable timestamps and a job ID, and the SPA can display that response for an explicit tournament-ID lookup. It must not backfill a live route from checked-in historical evidence. Missing or malformed infrastructure is `UNKNOWN`; it is never converted into fake progress or a terminal business failure.
