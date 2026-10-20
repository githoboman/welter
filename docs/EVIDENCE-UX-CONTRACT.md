# Evidence UX Contract

PrizeRail proves and settles the result recorded by the source game. It does not claim to detect off-chain cheating, prove gameplay fairness, or prove organizer honesty.

The UI must distinguish source facts, Attestcoin inclusion/history, Creditcoin semantic verification, payout state, and infrastructure observations. Every check is `PASS`, `FAIL`, or `UNKNOWN`.

## Evidence layers

### Source result evidence (Sepolia)

The UI may expose the following from a successful `MatchFinalized` receipt and `TournamentResultRegistry` read:

- source transaction hash, receipt status, block number, gas used, block timestamp, and Sepolia explorer URL;
- source contract address and source chain ID `11155111`;
- Attestcoin chain key `1` only when the runtime ChainInfo check confirms the mapping;
- decoded tournament ID, match ID, player addresses, winner, result code, finalization status, rules hash, result nonce, finalized timestamp, and reveal deadline;
- `MatchCreated`, `MoveCommitted`, `MoveRevealed`, and `MatchFinalized` event evidence when receipts/logs are available.

The decoded winner is a fact about the event emitted by the source contract. It is not evidence that the off-chain match was fair.

### Attestcoin evidence

The live scripts obtain a real USC SDK proof and preflight it through the CC3 native Block Prover. The checked-in evidence can expose:

- expected chain key and source block/header number;
- proof identifier/digest (`keccak256(encodedTransaction)` in the current evidence writer);
- cached flag when present;
- `verified: true` preflight result;
- proof retrieval latency as an observation, not an SLA;
- `AWAITING_ATTESTATION`, `PROOF_READY`, and infrastructure uncertainty only when the local or hosted worker reports them.

The current public evidence does not persist raw Merkle/continuity proof bytes. `npm run verify:demo` therefore labels the digest and preflight result as recorded evidence. Optional `npm run verify:proof -- <evidence>` retrieves proof material again from the public hosted prover, compares the digest/header, and reruns the CC3 native preflight without writes. Because retrieval is hosted/cache-dependent, unavailability is `UNKNOWN`, not `FAIL`.

### Creditcoin verification and settlement evidence

The UI may expose:

- ASC address and vault address;
- settlement transaction hash, receipt status, CC3 block number, gas used, timestamp, and explorer URL;
- `ResultVerified` event with tournament ID, business key, source-query key, winner, and result nonce;
- `TournamentSettled` event and policy state `CLAIMABLE`;
- semantic predicates: source chain key, source registry, receipt success, event signature, tournament ID, rules hash, source chain ID, result nonce, finalization status/result/winner, settlement deadline, and replay checks;
- replay mappings when a read can prove a key was consumed.

The strong claim supported by this evidence is: the deployed ASC accepted a native proof and the decoded source result satisfied the policy predicates before atomically making the vault claimable.

### Payout/refund evidence

The UI may expose:

- `PrizeClaimed` transaction hash, receipt status, CC3 block, gas, timestamp, winner, amount, and explorer URL;
- final vault policy state `CLAIMED` and a token `balanceOf(winner)` read;
- `TournamentRefunded` transaction/event when the organizer refund succeeds;
- `TournamentRecovered` transaction/event after the refund window, including third-party trigger and immutable organizer beneficiary;
- policy deadlines and current block time used to derive `REFUND_AVAILABLE` or `RECOVERY_AVAILABLE`.

The prize token is the project-owned `PRIZE` test token and has no monetary value. A balance must never be presented as real currency.

### Replay rejection evidence

The UI may expose:

- attempted replay transaction hash, target ASC, block, gas, receipt status `0`, error text when available, and explorer URL;
- or a preflight/estimation rejection with no transaction hash, clearly labeled as not mined;
- consumed source/business/query state when independently read.

The canonical third run has a mined status-`0` replay transaction. A failed estimation alone is not a mined replay receipt.

## Evidence field policy

| Field | Show | Trust/source | Caveat |
|---|---|---|---|
| Source tx hash/block/gas | Yes | Public Sepolia receipt | Receipt status must be checked. |
| Source contract | Yes | Receipt target + event emitter | Current ASC policy binds to the policy's registry; no global allowlist exists. |
| Decoded winner/tournament/rules/nonce | Yes | Event decode plus on-chain policy comparison | Describes recorded result, not gameplay truth. |
| Attestcoin proof header/digest/verified | Yes, with qualification | Recorded evidence; optional hosted reconstruction | Standard verifier treats it as recorded. Optional deep verification may independently reconstruct it or return `UNKNOWN`. |
| Creditcoin verification | Yes | CC3 settlement receipt and `ResultVerified`/`TournamentSettled` events | This is the strongest load-bearing proof artifact. |
| Settlement/payout tx | Yes | Public CC3 receipts/events | Hash alone is not success; require status and event binding. |
| Replay rejection | Yes | Status-`0` receipt or explicit preflight error | Distinguish mined rejection from no-submission estimation failure. |
| Blocks/timestamps | Yes | Public RPC | Mark `UNKNOWN` if RPC cannot return them. |
| Gas | Yes when recorded by receipt | Receipt `gasUsed` | Do not fabricate estimates as actual usage. |
| Worker attempts/lease/retry time | Yes for live worker records | Durable API/journal and worker evidence | The canonical completed artifact records attempts, retries, and lifecycle; its final lease/retry fields are null after completion. |
| Organizer/finalizer honesty or anti-cheat | No | Unsupported | Explicitly outside product claim. |

## Display requirements

1. Show the source result before describing it as claimable on Creditcoin.
2. Keep the source transaction, decoded predicates, settlement, payout, and replay links independently inspectable.
3. Use `UNKNOWN` for missing receipts, RPC/prover outages, absent raw proof, or contradictory evidence.
4. Do not present a completed historical JSON file as a live asynchronous status stream.
5. Surface trust/custody assumptions: source finalizer authority, worker availability, hosted prover latency, CC3/Sepolia testnet status, and test-token value.
6. Preserve the exact limitation copy: **PrizeRail proves and settles the result recorded by the source game. It does not claim to detect off-chain cheating.**

## UX constraints derived from the protocol

- Make proof visible as a short chain of verified predicates; progressively disclose raw hashes, ABI fields, and gas instead of overwhelming the primary result.
- Give every wallet transaction an explicit pending, mined-success, mined-failure, and timeout/reconciliation state.
- Explain the failed predicate or infrastructure uncertainty when verification does not complete.
- Keep organizer/finalizer, player, worker, and winner roles visibly distinct even though the canonical historical scripts conflate some addresses.
- Never let an organizer-recorded result look equivalent to a contract-proven/settled result.
- Make `CLAIMABLE`, `CLAIMED`, `REFUND_AVAILABLE`, `RECOVERY_AVAILABLE`, and `REFUNDED` unambiguous.
- Do not show fake realtime progress, fabricated balances, fabricated results, or a fixed proof/payout duration.
- Keep evidence independently inspectable through public RPC and explorer links without exposing private credentials.
