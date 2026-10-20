# Product Scoring Model

The organizer has not published numeric weights. This is an internal 100-point model used to compare serious candidates. Each criterion is scored 1–10; weighted score is `rating / 10 × weight`.

| Criterion | Weight | Why it matters |
|---|---:|---|
| Problem severity | 9 | Prevents technical novelty from substituting for a painful problem |
| User clarity | 5 | A judge should identify the buyer and beneficiary immediately |
| Market size | 4 | Rewards a credible wedge with room to grow |
| Startup potential | 5 | CEIP fast-track makes post-hackathon viability relevant |
| Creditcoin alignment | 7 | Creditcoin should own durable policy/settlement state |
| Attestcoin necessity | 12 | Core explicit scoring signal; proof must control the outcome |
| Testnet feasibility | 8 | The vertical slice must ship on CC3 and a supported source |
| Technical depth | 7 | Requires semantic validation, replay, and failure handling |
| Cross-chain meaningfulness | 7 | The remote fact must be indispensable to the product |
| Demo clarity | 8 | The result must fit a short, inspectable narrative |
| Judge comprehension | 5 | Reduces evaluation friction |
| Originality | 5 | Avoids cloning crowded submissions |
| Competitive differentiation | 4 | Defines why this product wins against visible entrants |
| Ecosystem value | 4 | Creates recurring Creditcoin usage and distribution potential |
| UX potential | 3 | Makes asynchronous attestation understandable |
| Defensibility | 2 | Rewards adapters, policy data, and workflow lock-in |
| Implementation risk | 5 | Higher score means lower delivery/infrastructure risk |

## Candidate scoring

| Candidate | Problem | User | Market | Startup | Creditcoin | Attestcoin | Feasible | Depth | Cross-chain | Demo | Comprehension | Original | Diff. | Ecosystem | UX | Defensibility | Implementation risk | Weighted total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| PrizeRail | 8 | 9 | 7 | 8 | 9 | 10 | 8 | 9 | 10 | 10 | 9 | 9 | 9 | 8 | 8 | 7 | 7 | **87.6** |
| CovenantPay | 8 | 8 | 8 | 8 | 9 | 9 | 7 | 9 | 9 | 8 | 8 | 7 | 7 | 8 | 7 | 7 | 7 | **80.6** |
| EscrowedRemit | 9 | 8 | 9 | 9 | 8 | 9 | 7 | 8 | 9 | 9 | 8 | 6 | 6 | 8 | 7 | 7 | 6 | **80.4** |
| ModelBounty | 7 | 8 | 7 | 7 | 8 | 9 | 7 | 8 | 9 | 9 | 8 | 8 | 8 | 7 | 7 | 6 | 6 | **78.0** |
| SignalSLA | 8 | 7 | 8 | 8 | 9 | 9 | 5 | 9 | 9 | 8 | 7 | 7 | 7 | 8 | 6 | 7 | 5 | **76.7** |

## Decision rules

- **FACT:** no numeric official rubric was published; this model must not be presented as organizer policy.
- **INFERENCE:** Attestcoin necessity, testnet evidence, and demo clarity deserve gating treatment because they are observable within judging time.
- **HYPOTHESIS:** a product scoring below 8/10 on Attestcoin necessity or testnet feasibility should not be selected, even if its market score is high.
