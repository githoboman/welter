# Red-Team Review

The following five candidates were the strongest after discovery scoring. The objections are intended to kill weak versions of each idea before implementation.

## Full challenge matrix

`YES` under “survives?” means the objection has a credible MVP mitigation, not that the risk disappears.

| Challenge | PrizeRail | CovenantPay | EscrowedRemit | ModelBounty | SignalSLA |
|---|---|---|---|---|---|
| Why would a judge reject it? | Toy/bridge appearance; source authority | Generic escrow | Crowded/compliance-heavy | Abstract AI-bounty story | Synthetic device evidence |
| Is Attestcoin necessary? | Yes: exclusive result-settlement path | Yes if tranche release is proof-only | Yes if exact payment gates release | Yes if acceptance proof gates bounty | Yes if receipt gates pay/slash |
| Is Creditcoin necessary? | Yes: funded policy/claims/replay hub | Yes: covenant/tranche state | Yes: escrow/refunds | Yes: bounty/claims | Yes: SLA/stake/payments |
| Is it just a bridge with a new name? | No tokens cross; a proven fact authorizes CC3 state | Risk: can look like one | High perception risk | Lower | Lower |
| Is the user problem real? | Plausible payout/dispute pain; demand unvalidated | Plausible grant/vendor pain | Severe remittance pain | Plausible benchmark dispute | Plausible operator settlement pain |
| Is someone already doing this? | No visible Attestcoin tournament settlement; adjacent WEN/ROPES | Many escrow/RWA analogues | Kirogi/Farebox overlap | Generic AI/agent field crowded | ChargeProof/AttestOps overlap |
| Is the demo too complicated? | No, if one tournament | No, if one milestone | No technically; story can sprawl | Moderate | Moderate-high |
| Can we actually finish it? | Yes after proof spike | Yes | Yes technically | Yes with deterministic registry | Hardware truth makes it risky |
| Does it require unavailable infrastructure? | Readability path documented; hosted services still a risk | Same | Same | Same | Real device feed may be unavailable |
| Is there a security problem? | Finalizer trust, decoder, replay, accounting | Milestone authority, replay | identity/refund/compliance | benchmark authority | device authenticity/oracle boundary |
| Is the business model believable? | Platform/API fee hypothesis | SaaS + settlement fee | Corridor fee but regulated | Marketplace fee hypothesis | Per-device SaaS hypothesis |
| Would users care? | Only if evidence reduces delays/disputes | Yes if workflows are machine-readable | Yes, but trust/compliance dominate | Buyer clarity weaker | Yes with real devices |
| Would Creditcoin care? | Expands Gaming and recurring proof/settlement use | Aligned but crowded | Aligned real-world settlement | Expands AI but generic | Aligned DePIN but crowded |
| Could another team build a better version in three days? | Generic copy yes; semantic/evidence depth is defense | Likely | Likely | Possible | Harder technically, but hardware demo differentiates |
| Compelling post-hackathon startup? | Tournament API/adapters/platform | Procurement/grant platform | Remittance infrastructure | Evaluation marketplace | DePIN settlement platform |
| Survives? | **YES — primary** | **YES — backup** | **YES — backup** | Maybe | No for current deadline |

## 1. PrizeRail

**Why a judge might reject it:** it looks like a bridge or a toy payout contract; the organizer may ask whether the game result is actually trustworthy.

**Attestcoin necessity:** strong only if settlement reverts without a valid proof and validates receipt status, source contract, event fields, winner, tournament, and replay. A UI-only proof is insufficient.

**Creditcoin necessity:** strong if Creditcoin owns reserve, policy, claim, refund, and settled state. Weak if it is only a second deployment.

**User/problem test:** tournament organizers and winners have a recognizable payout/dispute problem, but the MVP must show a funded prize and a result, not just “cross-chain gaming.”

**Business/user-care test:** operators may already use custodial tools and winners may tolerate manual payouts for small events. The wedge becomes believable only if PrizeRail reduces disputes, exposes independently checkable evidence, and can sell repeat settlement/API volume to tournament platforms. A testnet mock token alone does not validate willingness to pay.

**Demo/finishability:** a six-state flow is achievable. Attestation latency and decoder gas are the main schedule risks.

**Security/business objections:** authorized source finalizer remains a trust boundary; prize token has no real value; the platform must sell to tournament operators, not pretend to replace game anti-cheat.

**Three-day comparison:** another team could build a generic escrow UI quickly. PrizeRail’s defensible edge is the semantic ASC validation, replay domains, evidence bundle, and explicit source-authority boundary; without those it loses.

**Kill condition:** if a real proof cannot be generated and verified on CC3 early, stop and use a documented demo fixture only for read-only inspection—not as a claimed live settlement.

**Mitigation:** disclose the source authority, use a deterministic project-owned result registry, include wrong-contract/failed-receipt/replay negatives, and make “proof of recorded result” the exact claim.

## 2. CovenantPay

**Why reject:** grant/milestone escrow is already a common cross-chain pattern and can resemble RWA finance entrants.

**Attestcoin/Creditcoin tests:** both can be core, but a judge may see a generic event-triggered release.

**User/finishability:** real user pain, medium build; buyer and milestone truth are difficult to narrow.

**Kill condition:** if the demo needs off-chain document adjudication, it becomes an oracle story.

**Mitigation:** constrain to one machine-readable payment event and make the policy object explicit. Still loses on originality and field saturation.

**Would Creditcoin care?** likely yes at the primitive level, but the visible entrant cluster already makes the marginal ecosystem signal weaker than a gaming settlement wedge.

## 3. EscrowedRemit

**Why reject:** purpose-bound remittance overlaps visible Kirogi/Farebox-style products and may require identity/compliance claims.

**Attestcoin/Creditcoin tests:** technically strong, but the recipient-side truth and regulation boundary are large.

**Demo/finishability:** easy happy path; refunds, recipient identity, and compliance create scope creep.

**Kill condition:** if the story requires fiat rails or real KYC, it is not a hackathon MVP.

**Mitigation:** testnet stablecoin only and no compliance claims. It remains a backup, not the winner.

**Could another team beat it quickly?** yes: a direct payment proof plus release contract is a familiar template, so the demo would need exceptional corridor/user evidence to outrank PrizeRail.

## 4. SignalSLA

**Why reject:** DePIN entrants already prove receipts/uptime, and Attestcoin cannot prove that a physical device honestly measured the world.

**Attestcoin/Creditcoin tests:** strong for canonical receipt settlement, weak for physical truth.

**Demo/finishability:** hardware/source registry integration makes it risky within the deadline.

**Kill condition:** if no project-owned source registry can be demonstrated, the product is a dashboard over a mock.

**Mitigation:** narrow to a deterministic receipt registry, but that reduces startup credibility and still faces crowding.

**Would users care?** operators care about settlement disputes, but the demo user must see a real device/receipt or the product collapses into a synthetic event registry.

## 5. ModelBounty

**Why reject:** the source benchmark contract can be as trusted as the game result registry, but the user story is less immediately legible.

**Attestcoin/Creditcoin tests:** both can be load-bearing; off-chain model computation and scoring authority remain unresolved.

**Demo/finishability:** feasible if the benchmark is deterministic; market and category positioning are less distinctive.

**Kill condition:** if the benchmark result cannot be independently reproduced, it becomes “AI says winner.”

**Mitigation:** use a deterministic acceptance event and frame it as bounty settlement, but PrizeRail has a clearer emotional/demo moment.

**Startup test:** a benchmark marketplace may have a stronger software buyer, but its acceptance/scoring authority and reproducibility burden are harder to establish under the deadline.

## Overall decision

**FACT:** Attestcoin proves inclusion and canonical history, not off-chain fairness or physical truth.

**INFERENCE:** PrizeRail has the best balance of explicit proof semantics, Creditcoin settlement, low visible Gaming saturation, and a two-minute demo.

**HYPOTHESIS:** judges will forgive the registered-source-authority boundary if it is stated plainly and tested rigorously; they will penalize a product that hides it.
