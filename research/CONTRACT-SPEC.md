# Contract Specification

This document began as the pre-implementation specification. The implemented contracts and live evidence are now authoritative; see `research/IMPLEMENTED-ARCHITECTURE.md` and `IMPLEMENTATION-REPORT.md` for the current behavior.

## `TournamentResultRegistry` — Ethereum Sepolia

### State

- `finalizer`: authorized address for match creation. `finalize` itself is permissionless after both reveals or after the deadline.
- `matches[matchId]`: immutable participants/rules/deadline plus commit/reveal state and one derived result.
- The finalizer never supplies a winner to `finalize`; the contract derives it from the revealed moves.

### Operations

- `createMatch(tournamentId, matchId, playerOne, playerTwo, rulesHash, revealDeadline)`: only finalizer; validates unique nonzero IDs, distinct players, and a future deadline.
- `commit(matchId, commitment)`: only one of the two players; stores `keccak256(abi.encode(choice, salt))` before the deadline.
- `reveal(matchId, choice, salt)`: only a committed player; requires both player commitments to exist, then validates the caller's commitment and choice (`Rock=1`, `Paper=2`, `Scissors=3`).
- `finalize(matchId)`: callable after both reveals or after the deadline. It computes draw, normal win/loss, or timeout result, freezes the result nonce, and cannot be called twice.

### Canonical event

```solidity
event MatchFinalized(
    bytes32 indexed tournamentId,
    bytes32 matchId,
    address playerOne,
    address playerTwo,
    address winner,
    uint8 result,
    bytes32 rulesHash,
    uint256 resultNonce,
    uint8 finalizationStatus,
    uint64 sourceChainId,
    uint64 finalizedAt,
    uint64 deadline
);
```

The deployed indexed/non-indexed layout is frozen in `TournamentResultRegistry.sol` and mirrored in the ASC decoder/tests. The source chain ID is emitted by the contract and checked again by the ASC.

## `PrizeVault` — Creditcoin CC3

### Policy state

- tournament ID, organizer, source chain key, source registry, rules hash, and optional eligibility policy;
- prize token, funded amount, settlement deadline, refund deadline;
- enum state; claimable winner; consumed result nonce/hash.

### Operations

- `createTournament(...)`: validates immutable policy and deadlines.
- `fund(tournamentId, amount)`: transfers supported test token and activates a fully funded policy.
- `settle(tournamentId, winner, resultNonce, sourceQueryKey)`: callable only by ASC; moves `FUNDED` to `CLAIMABLE`.
- `claimFor(tournamentId)`: permissionless trigger; pays the frozen proven winner and moves to `CLAIMED`.
- `refund(tournamentId)`: only the immutable organizer after the settlement deadline and at or before the refund deadline; moves to `REFUNDED` and pays the organizer.
- `recoverExpired(tournamentId)`: permissionless after the refund deadline while still `FUNDED`; moves to `REFUNDED` before transfer and can pay only the immutable organizer.

### Invariants

- A tournament settles at most once and pays/refunds at most once.
- `claimed + refunded + outstanding == funded` per tournament, where `outstanding` is the vault-reserved amount not yet transferred or refunded.
- Active policy fields cannot mutate.
- Vault never trusts winner/source data from caller other than the ASC.

## `PrizeRailASC` — Creditcoin CC3

### Immutable/configured state

- vault address;
- Block Prover precompile address `0x0000000000000000000000000000000000000FD2`;
- ChainInfo precompile address `0x0000000000000000000000000000000000000fd3` or runtime interface;
- `EvmV1Decoder` from `@gluwa/asc-contracts@0.2.1`; the source event signature is immutable in the deployed ASC.

### `verifyAndSettle`

Inputs are the native proof/transaction query payload required by the installed Attestcoin SDK plus action `0`.

Required checks, in order:

1. configured source chain is supported and equals the policy chain key;
2. native proof verification succeeds;
3. proven receipt status equals `0x1`;
4. emitter/source contract equals policy registry;
5. log signature equals `MatchFinalized`;
6. decoded tournament ID and rules hash match policy; winner is nonzero and satisfies any frozen eligibility policy; result nonce is valid and unused;
7. policy is funded and within settlement deadline;
8. source transaction replay key is unused;
9. business result key `(sourceChainKey, sourceRegistry, tournamentId, resultNonce)` is unused;
10. mark both keys used and call vault settlement atomically.

### Replay domains

- Source transaction: `keccak256(chainKey, sourceTxHash)`.
- Business result: `keccak256(chainKey, sourceRegistry, tournamentId, resultNonce)`.
- Claim: vault state permits exactly one claim.

### Planned events/errors

- Events: `ResultVerified`, `TournamentCreated`, `TournamentFunded`, `TournamentSettled`, `PrizeClaimed`, `TournamentRefunded`, `TournamentRecovered`.
- Custom errors for wrong chain/source/event/field, failed receipt, expired/unfunded policy, replay, unauthorized caller, and invalid state.

## Access and upgrade stance

- MVP contracts are non-upgradeable.
- Admin may pause new creation/settlement only if defined before deployment; admin cannot rewrite funded policy or select a winner.
- Production source finalizer should be game-native or multisig/governance controlled. MVP single authority is disclosed.
