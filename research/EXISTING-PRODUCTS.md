# Existing Attestcoin and Creditcoin Products

Snapshot: 2026-09-08. This is a representative, decision-oriented inventory, not a claim that every one of the 67 dynamic DoraHacks records was fully accessible through the renderer.

## Official examples

| Project | What it demonstrates | Architecture/pattern | Strength | Limitation / avoid copying |
|---|---|---|---|---|
| [Attestcoin Protocol Examples](https://github.com/gluwa/attestcoin-protocol-examples) | Hello bridge, custom bridge, off-chain worker, and loan readability | Foundry/Yarn; source contract; ASC; reusable decoder; proof worker | Canonical integration reference | Examples are explicitly educational and bridge/loan shaped; not a product thesis |
| [USC testnet bridge examples](https://github.com/gluwa/usc-testnet-bridge-examples) | Legacy URL for the same/example lineage | Redirects to current example repo | Shows naming migration from USC | Repository/name references can be stale; use Attestcoin terminology in product copy |

## Comparison-field coverage

The table below records the requested architecture/product fields for the most decision-relevant references. Where a public README or submission page did not expose a field, it is marked `UNKNOWN` rather than inferred.

| Project | Problem / user | Track | Source → destination | Attestcoin role | Contracts / architecture | Frontend/backend pattern | Strength | Weakness / opportunity |
|---|---|---|---|---|---|---|---|---|
| Attestcoin Protocol Examples | Builder learns readability/bridge/loan patterns | Infrastructure/examples | Example source chains → Creditcoin | Core proof generation and ASC verification | Source contract + ASC + decoder + worker | CLI/SDK-oriented; exact UI varies by example | Canonical protocol reference | Not a differentiated end-user product |
| ChargeProof | EV operator/customer receipt settlement | DePIN | Sepolia → Creditcoin escrow | Proves device/payment receipt; semantic checks and replay | Receipt source + Creditcoin escrow + worker | Evidence-heavy UI/README and no-key verification | Strong exact-effect validation and evidence | Physical/device truth remains outside proof |
| Spark | Payment history improves credit access | DeFi/credit | Source-chain activity → Creditcoin credit line | Reads balances/history into underwriting state | Source proofs + score/credit contracts | Full-stack score/loan flow | Clear Attestcoin surface inventory | Crowded credit/loan pattern |
| SpaceFinance | Finance DePIN nodes | DePIN/DeFi | Node/collateral source → Creditcoin financing | Proofs support identity/collateral claims | Financing contracts plus partially mocked areas | Product dashboard plus honest mock disclosure | Transparent scope disclosure | Writability/attestor gaps reduce load-bearing depth |
| Kirogi | Purpose-bound tuition/remittance release | RWA | Remote payment → Creditcoin release | Payment evidence gates disbursement | Escrow/release workflow | Payment UX and settlement backend | Clear real-world outcome | Identity/compliance and adjacent entrants |
| WEN | Historical-price prediction game | Gaming | Game/source outcome → game state | Public submission describes game outcome; exact Attestcoin contract path UNKNOWN here | Product-specific game architecture UNKNOWN | Game UI | Shows Gaming track fit | Not reusable tournament settlement infrastructure |
| ROPES | One-minute prediction market as survival game | Gaming (adjacent) | Somnia/dreamDEX → Somnia registry | No Attestcoin/ Creditcoin use claimed | ArenaRegistry + executor + Postgres/Prisma + Next UI | Highly evidenced game loop, scripts, tests, operational fallback | Excellent UX/evidence/custody disclosure benchmark | Game-specific and chain-specific; not a PrizeRail substitute |

The broader BUIDL clusters below are intentionally summarized by pattern because individual DoraHacks pages do not expose the same technical schema consistently.

## Current live-submission clusters

### Credit, lending, and collateral — very crowded

- [Toxa](https://dorahacks.io/buidl/48335): Sepolia collateral proof, Creditcoin loan, score and LTV improvement.
- [Credence](https://dorahacks.io/buidl/48310): verified credit scoring and undercollateralized lending.
- [Spark](https://github.com/thesithunyein/spark): payment-history and balance proofs drive score/LTV and a Creditcoin credit line.
- [SpaceFinance](https://github.com/pplmaverick/spacefi): DePIN node collateral/identity proofs and financing; claims a partially mocked writability loop.
- [Privatecredit](https://github.com/0xaje/Privatecredit): autonomous cross-chain underwriting and P2P lending.
- [RWAs by Attest](https://dorahacks.io/buidl/48258): prove remote RWA ownership without moving/locking it, then lend.
- [Deadswitch](https://dorahacks.io/buidl/48255): prove collateral movement and liquidate a Creditcoin loan.
- [CovenantX](https://dorahacks.io/buidl/48233): external activity proofs enforce credit covenants.
- [Ledgerline](https://dorahacks.io/buidl/48260): aggregate DePIN earnings and lend against them.

**Conclusion:** do not build a generic “prove history/collateral, compute score, issue loan” product.

### RWA, trade, remittance, and payments — crowded but broader

- [Kirogi](https://dorahacks.io/buidl/48320): purpose-bound tuition remittance.
- [AttestFlow](https://dorahacks.io/buidl/48294): supply-chain finance with approval, financing, ownership, and settlement.
- [IPlink](https://dorahacks.io/buidl/48292): creator income proofs unlock capital without selling IP.
- [Kasuwa Credit OS](https://dorahacks.io/buidl/48273): merchant activity becomes reusable credit capacity.
- [ChargeProof](https://github.com/tang-vu/ChargeProof): device-signed EV receipt on Sepolia settles Creditcoin escrow, with unusually strong project-owned evidence and replay tests.
- [Farebox](https://dorahacks.io/buidl/48263): pay on another chain for account-less compute credits and bind settlement to usage roots.

**Conclusion:** there is room only for a tightly differentiated transaction-protection or settlement wedge. Broad “trade finance platform” positioning is already occupied.

### AI — crowded with generic agents, less so with enforceable boundaries

- [VeriAgent](https://dorahacks.io/buidl/48280): generic verified-data decision engine.
- [CreditPulse AI](https://dorahacks.io/buidl/48271): autonomous credit-risk oracle.
- [AEOS](https://dorahacks.io/buidl/48211): cited AI analysis plus deterministic DAO controls.
- [Sky Exec](https://dorahacks.io/buidl/48325): binds an approved action to stop agent mutation.
- [CarryProof](https://dorahacks.io/buidl/48257): yield agent acts only on verified source state.

**Conclusion:** “AI reads verified data and decides” is not differentiated. An AI entry needs a specific economic user and deterministic enforcement around the model.

### DePIN — several strong settlement/finance entries

- ChargeProof: metered EV charging settlement.
- SpaceFinance: node financing.
- Ledgerline: multi-network operator income underwriting.
- [AttestOps](https://dorahacks.io/buidl/48220): batch-proven uptime drives pay/scale/slash.

**Conclusion:** generic device receipts, uptime SLA, and node financing are occupied.

### Gaming — visibly underrepresented

- [WEN](https://dorahacks.io/buidl/48250): historical-price prediction game.
- [ROPES](https://github.com/neromtoobad/ropes): adjacent Somnia/dreamDEX prediction game with a highly evidenced on-chain play/settle/redeem loop. It is not a Creditcoin or Attestcoin project, and its README claims are self-reported rather than independently audited.

In the accessible official snapshot, Gaming had one listed product versus multiple RWA/DeFi entries. No visible entrant focused on proof-triggered tournament prize settlement.

**Lesson from ROPES:** a game can make chain activity legible through a strong metaphor, visible transaction evidence, explicit custody/risk disclosures, and recovery from unstable market cadence. PrizeRail should apply those product/evidence practices to a settlement primitive instead of competing as another prediction game.

## Strong patterns worth learning

- ChargeProof’s exact business validation after inclusion, pull-payment escrow, three replay domains, project-owned live evidence, and no-key judge verifier.
- Spark’s explicit inventory of Attestcoin surfaces and honest timing/state UX.
- SpaceFinance’s candid separation of genuine contracts from mocked attestor identity and unconnected roadmap features.
- Official examples’ separation of source contract, ASC, business logic, and worker.

## Weak/crowded patterns to avoid

- Counting SDK methods as “depth” while the business outcome remains generic.
- Claiming a successful transaction proves the intended effect.
- Treating a user-submitted transaction hash as trusted.
- Overstating mocked writability as protocol-native production messaging.
- Combining credit score, lending, RWA marketplace, identity, AI advisor, and payments into one demo.
- Reusing official bridge/loan examples with renamed entities.
- Unverifiable screenshots without project-owned hashes and addresses.

## White space selected

**PrizeRail:** an organizer funds a prize pool and immutable result policy on Creditcoin. A game/tournament finalizes its match on Sepolia. Attestcoin proves that exact successful result transaction. PrizeRail validates tournament ID, authorized source registry, rules hash, winner, score, nonce, and replay status, then makes the prize claimable. This applies Attestcoin to a lightly occupied track and a crisp economic problem.
