# Final Product Decision

## Selected direction

**PrizeRail — proof-bound tournament prize escrow**

## Backups

1. **CovenantPay:** machine-readable milestone escrow for grants/vendors.
2. **EscrowedRemit:** purpose-bound remittance release.

## Why the backups lose

- CovenantPay is closer to a crowded generic event-triggered escrow/RWA pattern.
- EscrowedRemit inherits identity, compliance, and recipient-truth complexity and overlaps visible submissions.

## Historical decision gates

The original decision required a spike to confirm:

1. CC3 `ChainInfo` reports Ethereum Sepolia support and expected chain key.
2. One known successful Sepolia transaction can be proven through the documented path.
3. A project-owned result event can be decoded and semantically rejected when malformed.
4. Replay rejection is observable on-chain.

All four gates were satisfied by the implemented and deployed path. If a future protocol change causes a gate to fail, preserve the same proof-gated escrow architecture and document the failure before considering a different product direction.
