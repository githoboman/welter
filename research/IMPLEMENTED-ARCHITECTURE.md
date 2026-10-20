# PrizeRail Implemented Architecture

## Boundary and trust model

PrizeRail proves and settles the result recorded by the source game. It does not prove that off-chain gameplay was fair, that a player did not cheat, or that an authorized source finalizer behaved honestly. The source contract is deterministic for the committed/revealed moves; the finalizer remains authorized to create matches and advance timeout finalization.

## End-to-end flow

1. `TournamentResultRegistry` on Sepolia creates a match with immutable tournament, match, player, rules-hash, and reveal-deadline fields. Only the configured `finalizer` may create a match.
2. Each player commits `keccak256(abi.encode(choice, salt))`. Both commitments must exist before either reveal. `finalize` is permissionless once both reveals exist or the deadline has passed, derives the result, and emits `MatchFinalized`.
3. The worker asks the official `@gluwa/usc-sdk@0.18.0` hosted `ProofBuilder` for the source transaction proof. Runtime `ChainInfo` validation confirms Attestcoin chain key `1` means Sepolia chain ID `11155111`.
4. The CC3 `0x0FD2` native block prover verifies transaction inclusion and continuity. `PrizeRailASC` then decodes receipt status and the canonical event and validates every business predicate.
5. `PrizeRailASC` atomically calls `PrizeVault.settle`. The vault changes `FUNDED -> CLAIMABLE`, freezing the proven winner, result nonce, and source-query key.
6. Anyone may call `claimFor`; the vault pays the frozen winner and changes `CLAIMABLE -> CLAIMED`.
7. Reusing the proof, encoded source transaction, or business result reverts. A separate claim-state check prevents double payout.

## Source adapter

`src/adapter.ts` defines the reusable `SourceResultAdapter<Result>` boundary. The only MVP adapter is `TournamentResultRegistry/RPS`, whose event signature is:

`MatchFinalized(bytes32,bytes32,address,address,address,uint8,bytes32,uint256,uint8,uint64,uint64,uint64)`

The adapter's business key is `tournamentId:resultNonce`. `proofToQuery` converts the SDK proof into the ASC native-query arguments without changing proof bytes.

## Deterministic RPS rules

Choices are `Rock=1`, `Paper=2`, `Scissors=3`. Rock beats Scissors, Paper beats Rock, and Scissors beats Paper. Equal revealed choices produce `Draw`. If only one player reveals after the deadline, that player wins by timeout; if neither reveals, the source result is a timeout draw. The result nonce is `uint256(keccak256(abi.encode(matchId)))`. The ASC accepts only normal player-one/player-two wins and timeout wins for prize settlement; draw and invalid outcomes are deliberately non-payable.

## Attestcoin and ASC validation

The ASC requires action `0`, expected chain key `1`, a successful source receipt, the exact `MatchFinalized` signature, the policy's source registry and rules hash, Sepolia source chain ID, a result nonce equal to `keccak256(matchId)`, a valid finalization status/result/winner combination, and a non-expired settlement policy. Proof inclusion is necessary but not sufficient for settlement.

## Replay domains

- `processedQueries` in `ASCBase`: the native query ID cannot be processed twice.
- `usedSourceQueries`: the hash of the encoded source transaction cannot settle twice even if query metadata differs.
- `usedBusinessResults`: `(sourceChainKey, sourceRegistry, tournamentId, resultNonce)` cannot be reused across source transactions.
- `PrizeVault` policy state: a tournament can be funded, settled, claimed, or refunded only once along its state-machine edges.

## Security assumptions and known limits

- The source finalizer is a privileged wallet for match creation. Finalization itself is permissionless. The contract computes a result from commitments/reveals but does not constrain which match a finalizer creates.
- Source registry binding is policy-local, not a global allowlist: the vault accepts any nonzero registry and the ASC compares the proof emitter with that policy value. The selected deployment/API boundary must enforce the intended registry.
- Normal refund is organizer-only after the settlement deadline and no later than the refund deadline. After that window, `recoverExpired` is permissionless but can transfer only to the immutable organizer and uses the existing `REFUNDED` terminal state.
- Live scripts resolve deployer, finalizer, organizer, players, proof worker, and payout trigger explicitly. The post-fix run used explicit reuse declarations for the two available funded wallets; it is not evidence of independently funded custody.
- The project-owned prize token is a test token with no monetary value.
- Hosted proof construction is asynchronous and availability-dependent. Observed live proof retrieval was approximately 12.6 seconds, 20.0 seconds, and 539.9 seconds in the three runs.
- CC3 and Sepolia are testnets. No production custody, audit, hosted frontend service, managed worker database, or Attestcoin writability path is claimed; the local worker uses a single-host append-only journal.
- Live evidence proves its selected/versioned deployment set and exact hashes in `evidence/`; it does not generalize to arbitrary source games or chain keys. The standard verifier checks recorded proof-preflight evidence plus public chain facts. Optional `verify:proof` retrieves proof bytes from the hosted prover, compares digest/header, and reruns the native read-only preflight; provider unavailability is `UNKNOWN`.
