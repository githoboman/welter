# Final Product Thesis — PrizeRail

## One-sentence thesis

PrizeRail is a proof-bound tournament prize escrow: a game result is finalized on Ethereum Sepolia, Attestcoin proves the exact successful transaction and canonical history to Creditcoin, and Creditcoin releases the funded prize only to the proven winner.

## Track and user

- **Primary track:** Gaming.
- **Primary user:** tournament/platform operator who wants auditable, non-custodial prize settlement.
- **Beneficiary:** winner who wants a claimable prize without organizer discretion after result finalization.

## Why this wins

- Gaming is visibly less crowded in the inspected BUIDL snapshot.
- The proof is load-bearing: no proof, no settlement.
- Creditcoin owns an economically meaningful reserve and claims state.
- The demo has a crisp before/after and a visible failed replay.
- The product can expand from one registry to many game/result adapters.
- Adjacent products such as ROPES show that gaming users respond to an immediate, evidenced on-chain loop; PrizeRail applies that lesson to the settlement layer rather than building another prediction game.

## Exact protocol roles

**Attestcoin:** proves Merkle inclusion and continuity for a source transaction; the ASC then validates successful receipt status, expected source contract, event selector, tournament ID, winner, rules hash, and result nonce.

**Creditcoin:** hosts `PrizeVault`/settlement state, payout policy, claim/refund logic, replay protection, and evidence records.

## Key journey

1. Organizer creates a tournament policy and funds a testnet prize vault on Creditcoin.
2. Players commit and reveal moves in the deterministic Sepolia RPS registry; `finalize` derives the winner and emits the canonical `MatchFinalized` event. The authorized finalizer can advance the deadline but cannot pass a winner to the contract.
3. Worker waits for attestation and obtains a proof for that exact transaction.
4. ASC verifies the proof and semantic predicates, then marks the prize claimable.
5. Winner claims on Creditcoin.
6. A second submission of the same proof fails with a replay error.

## Demo moment

The judge sees the same source transaction hash move from “recorded result” to “claimable on Creditcoin,” then sees a replay revert. Explorer links make every step independently inspectable.

## Startup path

Tournament-platform API → reusable result-adapter SDK → league/season accounting → multi-game settlement → operator analytics and dispute evidence.

## Explicit non-goals

- No anti-cheat or off-chain gameplay-fairness claim.
- No price oracle, AI referee, NFT marketplace, or cross-chain payout in MVP.
- No load-bearing Attestcoin writability.
- No real-money prize token or production legal/compliance claim.
- No prediction-market or game mechanic copied from adjacent products such as ROPES.
