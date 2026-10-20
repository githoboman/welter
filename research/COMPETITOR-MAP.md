# Competitor Map

## Landscape axes

| Cluster | Typical verified input | Creditcoin action | Saturation | Primary weakness/opportunity |
|---|---|---|---:|---|
| Credit history | Payments, repayments, balances | Score/LTV/loan | Very high | Hard to distinguish; self-dealing and underwriting assumptions |
| Collateral lending | Deposit/ownership/movement | Disburse/liquidate/release | Very high | Often another bridge-adjacent loan |
| RWA/trade finance | Invoice, approval, ownership, revenue | Finance/settle | High | Broad scope and off-chain truth boundaries |
| Purpose-bound payments | Remote deposit/payment | Release credits/funds | Medium | Needs exact semantic binding; Kirogi/Farebox already present |
| DePIN settlement | Device receipt/uptime/node registration | Pay/slash/finance | Medium-high | Hardware truth remains separate; several mature entrants |
| AI decisioning | Any proven cross-chain data | Agent action | High | Generic agent dashboards; model authority and safety ambiguity |
| Security middleware | Remote tx/effect | Allow/block settlement | Emerging | Strong technically, but may feel like developer tooling rather than end-user product |
| Gaming | Result/asset/achievement | Prize/economy/access | Low in visible field | Product credibility and source-game authority must be clear |

## Closest competitors to PrizeRail

| Competitor | Overlap | Difference |
|---|---|---|
| WEN | Gaming track, on-chain outcome | WEN is a prediction game; PrizeRail is reusable tournament settlement infrastructure |
| ROPES | Gaming product with on-chain prediction/settlement loop | ROPES is a Somnia/dreamDEX game; PrizeRail is a Creditcoin/Attestcoin proof-bound payout layer for registered results |
| Kirogi | Purpose-bound release based on external payment | Remittance/tuition versus game-result-authorized prize payout |
| ChargeProof | Escrow plus exact receipt verification and payout | DePIN device receipt versus game/tournament result; strongest architecture analogue |
| Milestone Relay Evidence Registry | Replay-safe external evidence | General evidence registry versus funded prize policy and payout product |
| ThirdCheck | Semantic validation of proven transactions | Developer security layer versus a concrete tournament business workflow |

## Differentiation requirements

PrizeRail is only differentiated if it delivers all of these:

1. A real funded Creditcoin prize pool, not a UI promise.
2. A project-owned Sepolia match result transaction.
3. Attestcoin verification as the exclusive settlement path.
4. Exact result semantics and replay rejection.
5. A winner claim and organizer refund path.
6. Tournament-platform framing, not “we made a game and bridged its event.”
7. Explicit source-authority disclosure: Attestcoin proves what the registered game contract recorded, not whether off-chain play was fair.

ROPES raises the bar for Gaming UX and evidence, but does not invalidate the product thesis: its README describes a game-specific Somnia/dreamDEX loop, while PrizeRail’s proposed wedge is chain-agnostic tournament settlement infrastructure anchored on Creditcoin and Attestcoin readability. That distinction must be visible in the demo and copy.

## Strategic position

```text
                    Generic platform
                         ↑
        AttestGO        |        generic AI agents
                        |
  finance-heavy --------+-------- non-finance
                        |
 Spark / Toxa           |        PrizeRail
 AttestFlow / SpaceFi   |        WEN
                        ↓
                    Narrow product
```

The desired position is narrow enough to finish, outside the lending pile, but reusable across multiple games after the hackathon.

## Competitive claims we should not make

- “First cross-chain gaming product” — unverified and probably false globally.
- “Trustless tournament result” — Attestcoin does not make an authorized source finalizer honest.
- “Instant payout” — attestation creates a wait before synchronous verification.
- “Any chain today” — current CC3 testnet source support must be queried.
- “No relayer” — an off-chain proof submitter is still operationally useful, even though it is not trusted for correctness.

## Sources

- [Official current BUIDLs](https://dorahacks.io/hackathon/buidl-ctc-2026-fall/buidl)
- Public repositories linked in [EXISTING-PRODUCTS.md](./EXISTING-PRODUCTS.md)
