# Demo Flow Contract

This is the exact frontend sequence for the hackathon demo. It is defined against the real deployed protocol, not against a mock API. The repository now provides a local live worker/API boundary and a completed worker-driven evidence artifact; a browser-reachable live worker still requires hosting and wallet integration.

## Demo sequence

### 1. Show the funded prize

Read `PrizeVault.policies(tournamentId)` and the token balance of the vault. Display organizer, token, amount, source registry, rules hash, settlement/refund deadlines, and `FUNDED` state. Link the funding receipts. State that `PRIZE` is a test token with no monetary value.

### 2. Resolve the deterministic source match

Read `TournamentResultRegistry.matches(matchId)` and show player addresses, commit/reveal flags, deadline, and current match state. The demo operator may create/commit/reveal through Sepolia wallet transactions if starting a fresh run. The UI must require both commitments before enabling either reveal.

### 3. Show the result

Call `finalize(matchId)` on Sepolia after both reveals or after the deadline. The call is permissionless and only needs a gas-paying wallet. Show the successful receipt, `MatchFinalized`, derived result, winner, rules hash, source chain ID, nonce, block, gas, and explorer link. Do not call the finalizer the exclusive finalizer; it controls match creation only.

### 4. Show Attestcoin verification lifecycle

The local watcher discovers the source transaction and creates a durable proof job; a future browser adapter may submit or
refresh the source identity, but the current API is read-only. Read the job through `/api/v1/proof-jobs/:jobId` and show:

```text
MINED -> AWAITING_ATTESTATION -> PROOF_READY -> PROOF_PREFLIGHT_PASS
```

Show source block/header, chain key, proof digest, cached flag, observed latency, and `UNKNOWN_RETRYABLE` when RPC/prover infrastructure is unavailable. Do not show fake percentage progress or a fixed completion promise. The current historical bundle can show only the completed preflight result, not this live lifecycle.

### 5. Show Creditcoin settlement

The worker or any valid proof submitter calls `PrizeRailASC.verifyAndSettle(...)` on CC3. Show `SUBMITTING`, then receipt status. On success show `ResultVerified`, `TournamentSettled`, policy `CLAIMABLE`, the semantic predicate checks, settlement block/gas, and explorer link. On failure show the decoded semantic error and leave the policy state unchanged.

The UI must not imply that the worker chose the winner. The ASC decodes and validates the proven event; the vault freezes the winner.

### 6. Show winner payout

Any CC3 wallet calls `PrizeVault.claimFor(tournamentId)`. Show `PAYOUT_PENDING` until a successful receipt, then `PrizeClaimed`, `CLAIMED`, frozen winner, amount, token balance, block/gas, and explorer link. The caller is only a trigger; payout recipient is not caller-supplied.

### 7. Attempt replay

Resubmit the same proof/source transaction. Show the attempt as `SUBMITTING`, then `REPLAY_REJECTED` only after a mined status-`0` receipt or a clearly labeled preflight rejection. Explain source-query and business-result replay domains. The canonical evidence includes a mined status-`0` transaction; a reverted estimate without a hash is a different outcome.

### 8. Open verification/evidence view

Present a compact evidence table with:

- source tx, source registry, decoded winner/tournament/rules/nonce, source block/timestamp/gas;
- Attestcoin chain key, proof header/digest, preflight result, and latency qualification;
- CC3 ASC/vault addresses, settlement tx/event, policy state;
- payout tx/event/balance;
- replay tx/status or estimation outcome;
- explorer links and the no-key verifier command.

Include the limitation: **PrizeRail proves and settles the result recorded by the source game. It does not claim to detect off-chain cheating.**

## Live versus historical demo modes

| Mode | What can be shown | Required disclosure |
|---|---|---|
| Live | Wallet pending states, source actions, proof waiting, settlement/payout receipts, replay attempt. | Requires the local or hosted worker/API plus browser wallet integration; no hosted live browser service exists yet. |
| Historical | Completed source/Attestcoin/settlement/payout/replay evidence from `evidence/live-latest.json` and the three-run log. | Label every panel as historical evidence; do not animate or imply current pending work. |

## Demo failure behavior

- Wallet rejection: remain at the prior state, identify the rejected action, and allow explicit retry.
- RPC timeout: show `UNKNOWN`, retain the tx hash if one exists, and reconcile before resubmitting.
- Prover outage/slow attestation: show `AWAITING_ATTESTATION` or `INFRASTRUCTURE_UNAVAILABLE`; never claim proof failure.
- Semantic rejection: show the failed predicate/error and preserve the funded policy state.
- Draw/unsupported source result: show `NON_PAYABLE_RESULT`; a source `MatchFinalized` event alone does not make a prize claimable.
- Settlement timeout: query CC3 receipts/events/policy before any retry.
- Claim timeout: query policy and `PrizeClaimed` before resubmission.
- Refund window missed: show `RECOVERY_AVAILABLE`; any caller may trigger recovery, but explain that the immutable organizer is the only beneficiary.
