# PrizeRail: Proof-Bound Tournament Prize Escrow & Autonomous Settlement Protocol

**A Technical Whitepaper for BOT Chain Ecosystem Deployment**  
**Version**: 1.0 (BOT Chain Edition)  
**Date**: October 2026  
**Status**: Live on BOT Chain Testnet (Chain ID: `968`)  
**Repository**: [github.com/unifyWeb3/prizerail](https://github.com/unifyWeb3/prizerail)  
**Live DApp**: [prizerail.vercel.app](https://prizerail.vercel.app)  

---

## Abstract

Competitive gaming and decentralized eSports suffer from a fundamental architectural asymmetry: while game logic and match outcomes are increasingly executed or recorded on-chain, prize pool distributions remain tethered to centralized custody, off-chain organizer promises, or high-latency multi-signature wallets. This discrepancy introduces counterparty risk, payout delays, dispute friction, and malicious prize withholding.

**PrizeRail** resolves this trust gap by introducing an autonomous, non-custodial prize escrow and settlement protocol natively deployed on **BOT Chain**. By combining immutable on-chain prize policies with cryptographic result verification, PrizeRail guarantees that prefunded prize reserves locked in escrow are automatically and irrevocably unlocked only to the proven match winner. Leveraging BOT Chain's high-performance throughput and sub-second block finality (~0.75s), PrizeRail achieves instant, gas-efficient, and mathematically deterministic tournament settlement.

---

## 1. Introduction: The Settlement Trust Gap

In competitive Web3 tournaments, players participate based on the expectation of a guaranteed prize payout. However, existing tournament structures typically follow one of two flawed paradigms:

1. **Centralized Custody**: Organizers collect entry fees into an off-chain account or personal wallet, promising to disburse rewards after the event concludes. This creates severe counterparty risk, exit scams, and tax/regulatory burdens on organizers.
2. **Disconnected On-Chain State**: Games that execute matches on smart contracts still rely on an organizer or trusted oracle to manually sign a secondary payout transaction. An on-chain result thus frequently ends in an off-chain promise.

### The PrizeRail Solution
PrizeRail re-architects tournament economics into an atomic, proof-bound pipeline:
- **Prefunded Escrow**: The prize purse is locked inside an immutable `PrizeVault` prior to match commencement.
- **On-Chain Registry**: Game outcomes are derived deterministically on-chain via commit-reveal schemes or cryptographic signatures in the `TournamentResultRegistry`.
- **Autonomous Settlement**: The `BotChainSettler` validates match predicates (tournament ID, rules hash, participant addresses, and finalization status) and moves the policy to a claimable state.
- **Frozen Beneficiary Claim**: Payout execution is permissionless; anyone can trigger the disbarment transaction, but funds can only be routed to the immutable winner frozen in the policy.

---

## 2. System Architecture on BOT Chain

PrizeRail is designed with strict separation of concerns between game execution, escrow custody, and settlement authority.

```text
 ┌────────────────────────────────────────────────────────┐
 │                      ORGANIZER                         │
 └──────────────────────────┬─────────────────────────────┘
                            │ 1. createTournament & fund()
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │                      PrizeVault                        │
 │  • Holds ERC-20 PRIZE tokens in non-custodial escrow   │
 │  • Enforces immutable rules hash, amount, & deadlines  │
 └──────────────────────────▲─────────────────────────────┘
                            │ 4. settle() & claimFor()
                            │
 ┌──────────────────────────┴─────────────────────────────┐
 │                   BotChainSettler                      │
 │  • Verifies match predicates against ResultRegistry    │
 │  • Replay rejection & single-settlement invariant     │
 └──────────────────────────▲─────────────────────────────┘
                            │ 3. settleMatch()
                            │
 ┌──────────────────────────┴─────────────────────────────┐
 │              TournamentResultRegistry                  │
 │  • Deterministic commit/reveal match execution         │
 │  • Derives winner, finalization timestamp, & nonce     │
 └──────────────────────────▲─────────────────────────────┘
                            │ 2. commit, reveal, finalize
                            │
 ┌──────────────────────────┴─────────────────────────────┐
 │                   PLAYERS / GAMERS                     │
 └────────────────────────────────────────────────────────┘
```

### 2.1 Component Specifications

#### A. `TournamentResultRegistry.sol`
A deterministic match execution engine. In the reference implementation, players execute a zero-knowledge commit-reveal game (Rock-Paper-Scissors):
- **Commit Phase**: Players submit $H(\text{choice} \parallel \text{salt})$, hiding their move until both commitments are mined.
- **Reveal Phase**: Players reveal choices within a bounded window.
- **Finalization**: Evaluates moves on-chain, emits `MatchFinalized`, and computes an unforgeable `resultNonce = keccak256(matchId)`.

#### B. `PrizeVault.sol`
A non-reentrant, non-custodial escrow contract governing tournament funds:
- **State Machine**: `DRAFT` $\rightarrow$ `FUNDED` $\rightarrow$ `CLAIMABLE` $\rightarrow$ `CLAIMED` (or `REFUNDED`).
- **Settlement Binding**: Accepts settlement calls exclusively from the designated `settlementAuthority` (`BotChainSettler`).
- **Beneficiary Invariant**: Payout recipient is strictly immutable once settled.

#### C. `BotChainSettler.sol`
The autonomous correctness boundary:
- Performs cross-contract validation ensuring that the match's tournament ID, source registry, and rules hash match the escrow policy exactly.
- Prevents replay attacks through internal mapping `settledTournaments`.

---

## 3. Protocol State Machine & Security Guarantees

```text
       ┌─────────┐
       │  DRAFT  │
       └────┬────┘
            │ fund() [exact token transfer]
            ▼
       ┌─────────┐
       │ FUNDED  │───────────────┐
       └────┬────┘               │
            │ settleMatch()      │ refund() / recoverExpired()
            ▼                    │ [if settlement expires]
      ┌───────────┐              ▼
      │ CLAIMABLE │         ┌──────────┐
      └─────┬─────┘         │ REFUNDED │
            │ claimFor()    └──────────┘
            ▼
       ┌─────────┐
       │ CLAIMED │ [Funds delivered to winner]
       └─────────┘
```

### 3.1 Replay Protection
A common vulnerability in prize escrow systems is double-claiming or replays of previously settled matches. PrizeRail enforces three independent replay domains:
1. **Registry Nonce**: Matches can only be finalized once; subsequent finalize calls revert with `InvalidState`.
2. **Settler Tracking**: `settledTournaments[tournamentId]` ensures a tournament policy cannot be processed twice.
3. **Vault State Lock**: `settle()` requires `policy.state == State.FUNDED`, immediately transitioning to `CLAIMABLE`.

### 3.2 Permissionless Execution Without Custody Dilution
The payout trigger (`claimFor`) is fully permissionless. Any automated relayer, keeper, or user can sponsor gas to trigger payout, but the destination address is hard-coded to `policy.winner`. Callers cannot redirect funds.

### 3.3 Two-Stage Expiration & Organizer Recovery
To protect organizers against unplayed matches or abandoned tournaments, PrizeRail implements a dual-deadline mechanism:
- **Settlement Deadline**: If no valid winner is settled prior to `settlementDeadline`, settlement is blocked.
- **Organizer Refund Window**: Between `settlementDeadline` and `refundDeadline`, the organizer can invoke `refund()` to reclaim locked funds.
- **Permissionless Recovery**: After `refundDeadline`, anyone can invoke `recoverExpired()` to safely push funds back to the organizer's original address.

---

## 4. The BOT Chain Advantage

Deploying PrizeRail natively on **BOT Chain** provides critical infrastructural advantages over traditional Layer-1 blockchains:

| Metric | Traditional EVM (e.g. Ethereum) | BOT Chain Testnet | PrizeRail Impact |
| :--- | :--- | :--- | :--- |
| **Block Time** | ~12.0 seconds | **~0.75 seconds** | Matches settle and payout within 1 second of final move. |
| **Transaction Fee** | $1.50 – $25.00+ | **< $0.001** | Enables micro-tournaments ($1–$5 entry fees) without fee erosion. |
| **Finality** | Multi-block probabilistic | **Immediate deterministic** | Eliminates reorg risk and front-running on revealed commitments. |
| **Throughput** | ~15 – 30 TPS | **High-performance parallel** | Supports thousands of concurrent matches across eSports brackets. |

---

## 5. Live Testnet Deployment Facts

PrizeRail is deployed and operational on the **BOT Chain Testnet** (Chain ID: `968`).

- **Deployer Wallet**: `0x29108bAb564B53B19C5dde4D00048DB6C41e057C`
- **Network RPC**: `https://rpc.bohr.life`
- **Block Explorer**: `https://scan.bohr.life`

### Core Contract Registry
| Contract Name | Deployed Address | Deployment Tx | Block |
| :--- | :--- | :--- | :--- |
| **TournamentResultRegistry** | `0x4E64c9a173440e1375460605b7959C3093370d78` | `0x54998055...7100` | 27531122 |
| **MockPrizeToken (PRIZE)** | `0x5A165Cb40fcF5E97ed7f9af37f45a19C1236f664` | `0x685baaa9...6875` | 27531134 |
| **PrizeVault** | `0x6edC23FD53d5f861c460397337f505DDF88fCB32` | `0x63aab24b...045` | 27531139 |
| **BotChainSettler** | `0x81f6611d25a7533885dd34bce10600aff0E2E4DE` | `0xd14c3d0a...600d` | 27531145 |

### Complete 13-Step Lifecycle Verification
The full lifecycle was executed on-chain with verified receipts recorded in blocks `27534910` through `27534988`:
1. **Player Gas Distribution**: `0x1b29c003b0ef4dbfaeaddf656ffffa11865d1603578662635294aafa98397750`
2. **Prize Token Mint**: `0x1341b35d7e9f9607ac18f25ab3bc73552681171d665c315e2c149c51dfcbd758`
3. **Escrow Approval**: `0xe13b583457c1584618367cc7e7dac1e6e17801cfed6f2652855b27f2ef1062e6`
4. **Policy Registration**: `0x9b931c83eec77fd3c17afb7690f3e42186323731f5301f9c65fc349a0528fbd3`
5. **Prize Escrow Funding**: `0xb568eafabbfa7eef86c13cbec73d687162e03b693114cdbedbdd2e13c5b19eae`
6. **Match Registration**: `0x861799e135015cd67a94fdf64706870d98d4b564c4ddb792dce29c0023000cb5`
7. **Player 1 Commit**: `0x4a36cd4896993fec9d1af6331a50ee7d566c661af629358adcad8a4b84bd31bf`
8. **Player 2 Commit**: `0x61601d7a6a5a8abfb15b99d545e42482a2aed57abe80e9ea1c1429ae457a5555`
9. **Player 1 Reveal**: `0x2db75073a94e18fed0602f18070d631489f373cb0e9bc1b1f11110fc07c5025b`
10. **Player 2 Reveal**: `0x337493486631b7fd841ebc6a50ba0aac58a1a95f48835b675fdcd4f2741652e1`
11. **Match Finalization**: `0xcb02a05a932c3ba69640d4ab39e04ae3049bfb517a02c8895ebf8ed6927fea4d`
12. **Autonomous Settlement**: `0x38583e9b31c93ea08158b606128194df5629bf498b8f03acea04d624a69553fb`
13. **Winner Prize Disbarment**: `0xb8abb1f9ca6d60af70be84c4c7a73ea02af892c13fb81fccf696a22894e3d32d`

---

## 6. Ecosystem Roadmap

1. **Phase 1: Testnet Validation (Current)**
   - Smart contracts deployed on BOT Chain Testnet (`968`).
   - Web application operational with MetaMask / EIP-1193 wallet support.
   - Verified 13-step lifecycle demonstration.

2. **Phase 2: Game Engine SDKs & Bracket Coordinator**
   - Unity and Unreal Engine SDKs for direct BOT Chain match outcome registration.
   - Bracket Coordinator contract for multi-stage single/double-elimination tournaments.

3. **Phase 3: BOT Chain Mainnet Deployment**
   - Deployment on BOT Chain Mainnet (`Chain ID: 677`).
   - Native BOT coin staking and USDT liquidity pool integration.
   - Formal audits and bug bounty initiatives.

---

## 7. Conclusion

PrizeRail establishes a new benchmark for trustless tournament prize distribution. By uniting immutable escrow policies with deterministic on-chain verification, PrizeRail eliminates the risk of organizer default and payment delays. On BOT Chain, sub-second settlement converts competitive Web3 gaming into a seamless, instant-gratification reality.

---

## References & Official Links
- **Documentation**: [dev-docs.botchain.ai](https://dev-docs.botchain.ai/docs/intro)
- **Explorer**: [scan.bohr.life](https://scan.bohr.life)
- **PrizeRail DApp**: [prizerail.vercel.app](https://prizerail.vercel.app)
- **Project Deck**: `docs/PrizeRail-Project-Deck.pdf`
- **Interaction Evidence**: `docs/ON-CHAIN-INTERACTION-RECORDS.md`
