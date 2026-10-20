# Idea Landscape

Snapshot: 2026-09-08. These are discovery hypotheses, not commitments or claims that the infrastructure is already available. Every chain other than Ethereum Sepolia and Creditcoin CC3 should be treated as `UNKNOWN` until queried through Attestcoin ChainInfo.

## Opportunity cards

### 1. CovenantPay — DeFi

- **Problem/user:** DAO treasurers need to release grants only after a verified milestone payment or delivery.
- **Workaround/importance:** multisig screenshots and manual spreadsheets; errors create disputes and reputational loss.
- **Solution:** a Creditcoin covenant escrow releases a tranche only when a registered source-chain event is proven.
- **Creditcoin usefulness:** durable escrow, policy, tranche accounting, and claims live on the EVM L1.
- **Attestcoin necessity:** the release predicate requires a canonical source transaction, not a signer assertion.
- **Cross-chain input/source:** payment or milestone event from Ethereum Sepolia (MVP candidate); other chains UNKNOWN.
- **Creditcoin action/flow:** fund → prove event → release tranche → record receipt → refund remainder.
- **Business/startup:** SaaS fee per covenant; expand to grant, procurement, and vendor finance.
- **Demo/complexity/risks:** clear two-step demo; medium complexity; semantic decoding, attestation latency, and source-authority risk.
- **Saturation/differentiation/judge appeal:** DeFi/RWA escrow is crowded; policy-bound tranche release is narrower and inspectable.

### 2. ProofMargin — DeFi

- **Problem/user:** derivatives venues cannot safely use cross-chain collateral claims without trusting an oracle.
- **Workaround/importance:** centralized risk desks; slow and opaque liquidations can create bad debt.
- **Solution:** Creditcoin margin account accepts only proven deposits and enforces deterministic health bands.
- **Creditcoin usefulness:** collateral ledger and liquidation policy require a common execution hub.
- **Attestcoin necessity:** proves deposit/withdrawal transactions and canonical history from the collateral chain.
- **Cross-chain input/source:** ERC-20 deposit event on Sepolia; production source set UNKNOWN.
- **Creditcoin action/flow:** register vault → prove deposit → credit margin → breach health → liquidate/refund.
- **Business/startup:** risk-engine API plus liquidation fee; large market but regulated and technically heavy.
- **Demo/complexity/risks:** compelling but hard to explain; high complexity; pricing, oracle, and economic-model risks.
- **Saturation/differentiation/judge appeal:** very saturated lending/collateral field; likely weak differentiation.

### 3. InvoiceLatch — DeFi/RWA

- **Problem/user:** SME lenders need proof that an invoice was paid before closing a credit line.
- **Workaround/importance:** PDFs and bank confirmations; duplicate financing and fraud are costly.
- **Solution:** payment evidence closes or reprices a Creditcoin invoice facility.
- **Creditcoin usefulness:** holds facility state, repayment schedule, and lender claims.
- **Attestcoin necessity:** proves the payment event and amount on a source chain.
- **Cross-chain input/source:** stablecoin payment on Sepolia; bank/other chains UNKNOWN.
- **Creditcoin action/flow:** register invoice → draw → prove payment → close/adjust facility.
- **Business/startup:** lender API and servicing fee; clear buyer but crowded.
- **Demo/complexity/risks:** easy state transition; medium; invoice identity and off-chain invoice truth.
- **Saturation/differentiation/judge appeal:** overlaps many current RWA/credit entries; moderate appeal.

### 4. LiquidityPassport — DeFi

- **Problem/user:** liquidity providers cannot carry verifiable activity history between venues.
- **Workaround/importance:** self-reported dashboards and screenshots; sybil and wash-trading concerns.
- **Solution:** prove exact liquidity events and issue a bounded Creditcoin fee tier or access pass.
- **Creditcoin usefulness:** policy registry and non-transferable benefit state.
- **Attestcoin necessity:** canonical event proof prevents a venue from relying on an unverified API.
- **Cross-chain input/source:** AMM events on Sepolia; supported venues UNKNOWN.
- **Creditcoin action/flow:** register pool → prove events → update tier → expire/revoke.
- **Business/startup:** analytics/API fee; moderate market.
- **Demo/complexity/risks:** understandable; medium; identity, wash trading, and event volume.
- **Saturation/differentiation/judge appeal:** less crowded than loans but still finance-adjacent.

### 5. EscrowedRemit — RWA

- **Problem/user:** remittance operators need purpose-bound release when a recipient-side payment is confirmed.
- **Workaround/importance:** custodial reconciliation and screenshots; failed reconciliation strands funds.
- **Solution:** Creditcoin escrow releases a testnet remittance only after a registered recipient payment is proven.
- **Creditcoin usefulness:** neutral settlement and refund state across corridors.
- **Attestcoin necessity:** exact payment, recipient, and amount are verified from the source chain.
- **Cross-chain input/source:** Sepolia stablecoin transfer (MVP candidate); destination rails UNKNOWN.
- **Creditcoin action/flow:** fund → prove recipient transfer → mark delivered → claim/refund.
- **Business/startup:** corridor settlement fee; strong real-world story, but Kirogi/Farebox overlap.
- **Demo/complexity/risks:** very clear; medium; recipient identity and compliance boundaries.
- **Saturation/differentiation/judge appeal:** medium-high saturation; purpose-bound escrow is the differentiator.

### 6. RoyaltyAdvance — RWA

- **Problem/user:** creators cannot finance future royalties without surrendering ownership.
- **Workaround/importance:** opaque platform statements and factoring; expensive capital and disputes.
- **Solution:** prove royalty receipts, then Creditcoin advances against a bounded stream.
- **Creditcoin usefulness:** facility, repayment, and investor claims.
- **Attestcoin necessity:** receipt history must be canonical and contract-bound.
- **Cross-chain input/source:** creator marketplace payouts on Sepolia; real platforms UNKNOWN.
- **Creditcoin action/flow:** register catalog hash → prove receipts → quote advance → repay/close.
- **Business/startup:** origination and servicing fees; sizeable market.
- **Demo/complexity/risks:** strong narrative; high; IP, valuation, and future-cash-flow risk.
- **Saturation/differentiation/judge appeal:** IPlink occupies adjacent territory; moderate appeal.

### 7. CarbonDelivery — RWA

- **Problem/user:** buyers need evidence that a tokenized environmental delivery actually occurred.
- **Workaround/importance:** issuer attestations and PDFs; greenwashing and double counting undermine trust.
- **Solution:** Creditcoin escrow releases payment when a registered retirement/delivery event is proven.
- **Creditcoin usefulness:** settlement, retirement registry, and buyer claims.
- **Attestcoin necessity:** proves source registry event and prevents mutable API evidence.
- **Cross-chain input/source:** registry contract on Sepolia; authoritative registry UNKNOWN.
- **Creditcoin action/flow:** lock funds → prove retirement → settle → expose audit record.
- **Business/startup:** per-credit settlement/audit fee; enterprise potential.
- **Demo/complexity/risks:** clear but domain-heavy; high; oracle/registry authority and legal claims.
- **Saturation/differentiation/judge appeal:** RWA crowded; likely weaker than a gaming wedge.

### 8. TradeRelease — RWA

- **Problem/user:** importers and financiers need release on verified customs or delivery milestones.
- **Workaround/importance:** scanned documents and brokers; delays tie up working capital.
- **Solution:** milestone escrow with source-chain event proofs and explicit refund windows.
- **Creditcoin usefulness:** shared state between buyer, financier, and logistics provider.
- **Attestcoin necessity:** binds release to immutable event history.
- **Cross-chain input/source:** logistics registry or tokenized document contract on Sepolia; production source UNKNOWN.
- **Creditcoin action/flow:** create lot → fund → prove milestone → release/refund.
- **Business/startup:** enterprise SaaS and settlement fee.
- **Demo/complexity/risks:** medium clarity; high; off-chain document truth.
- **Saturation/differentiation/judge appeal:** AttestFlow and related projects make this crowded.

### 9. SignalSLA — DePIN

- **Problem/user:** hardware operators need payments tied to independently verifiable uptime.
- **Workaround/importance:** vendor dashboards; disputes over uptime delay payment.
- **Solution:** register SLA and prove heartbeat batches before Creditcoin pays an operator.
- **Creditcoin usefulness:** recurring settlement, slashing, and operator claims.
- **Attestcoin necessity:** canonical heartbeat/receipt events are the payment predicate.
- **Cross-chain input/source:** device registry on Sepolia; real IoT chain UNKNOWN.
- **Creditcoin action/flow:** stake → prove batch → pay/slash → roll period.
- **Business/startup:** per-device SaaS and settlement fee.
- **Demo/complexity/risks:** visually strong; high; device authenticity remains outside proof.
- **Saturation/differentiation/judge appeal:** DePIN has several entrants; recurring batch policy helps.

### 10. FleetLease — DePIN/RWA

- **Problem/user:** fleet financiers need proof that leased assets generate contracted usage.
- **Workaround/importance:** telematics exports; lenders lack timely, tamper-resistant evidence.
- **Solution:** usage proof triggers lease payment or covenant status on Creditcoin.
- **Creditcoin usefulness:** lease ledger and lender/operator settlement.
- **Attestcoin necessity:** verifies metered usage events.
- **Cross-chain input/source:** vehicle telemetry registry on Sepolia; production source UNKNOWN.
- **Creditcoin action/flow:** register asset → prove usage → invoice/settle → flag covenant.
- **Business/startup:** fleet SaaS plus finance fee.
- **Demo/complexity/risks:** medium; hardware oracle and privacy risk.
- **Saturation/differentiation/judge appeal:** overlaps ChargeProof/SpaceFinance.

### 11. ComputeMeter — DePIN

- **Problem/user:** decentralized compute buyers need usage-bound settlement rather than prepaid trust.
- **Workaround/importance:** centralized usage APIs; overbilling and non-payment disputes.
- **Solution:** prove usage root and settle a Creditcoin escrow.
- **Creditcoin usefulness:** buyer/provider escrow and dispute windows.
- **Attestcoin necessity:** validates source metering transaction.
- **Cross-chain input/source:** compute marketplace on Sepolia; source implementation is a design dependency.
- **Creditcoin action/flow:** fund → prove usage → pay provider → refund unused amount.
- **Business/startup:** take rate on compute settlement.
- **Demo/complexity/risks:** strong demo; medium-high; metering and availability.
- **Saturation/differentiation/judge appeal:** Farebox is adjacent; usage-root semantics could differentiate.

### 12. SolarReceipt — DePIN/RWA

- **Problem/user:** solar asset owners need verifiable production records for financing.
- **Workaround/importance:** spreadsheets and installers’ portals; financing terms are conservative.
- **Solution:** prove production receipts and update a Creditcoin financing covenant.
- **Creditcoin usefulness:** covenant, reserve, and investor reporting.
- **Attestcoin necessity:** source event history is the evidence input.
- **Cross-chain input/source:** energy registry on Sepolia; authoritative registry UNKNOWN.
- **Creditcoin action/flow:** register panel → prove period → update covenant/pay.
- **Business/startup:** asset-finance SaaS.
- **Demo/complexity/risks:** high domain complexity and oracle boundary.
- **Saturation/differentiation/judge appeal:** moderate; less suitable for deadline.

### 13. PrizeRail — Gaming (primary candidate)

- **Problem/user:** tournament winners wait for or dispute organizer-controlled payouts.
- **Workaround/importance:** spreadsheets, custodial wallets, and manual screenshots; disputes damage trust and retention.
- **Solution:** a proof-bound Creditcoin prize escrow releases only to the winner recorded by a registered source-chain result contract.
- **Creditcoin usefulness:** reserve, rules, settlement, claims, refunds, and replay state.
- **Attestcoin necessity:** only a valid inclusion + canonical-history proof of the exact successful `MatchFinalized` transaction can authorize settlement.
- **Cross-chain input/source:** Ethereum Sepolia tournament result registry (MVP); other game chains later, subject to ChainInfo support.
- **Creditcoin action/flow:** fund → finalize result → await attestation → prove → settle → winner claims; replay fails.
- **Business/startup:** tournament-platform fee and white-label API; expand to games, leagues, and esports operators.
- **Demo/complexity/risks:** simple, memorable vertical slice; medium; source finalizer authority, proof latency, decoder gas.
- **Saturation/differentiation/judge appeal:** visible Gaming field is sparse; load-bearing proof and funded payout are distinctive.

### 14. AchievementVault — Gaming

- **Problem/user:** games cannot safely unlock rewards for achievements recorded on another chain.
- **Workaround/importance:** centralized APIs; reward fraud and account disputes.
- **Solution:** prove achievement event, then unlock a Creditcoin reward claim.
- **Creditcoin usefulness:** reward inventory and anti-replay state.
- **Attestcoin necessity:** exact player/achievement/event must be proven.
- **Cross-chain input/source:** game contract on Sepolia; production games UNKNOWN.
- **Creditcoin action/flow:** register achievement → prove → claim reward → prevent duplicate claim.
- **Business/startup:** SDK fee to game studios.
- **Demo/complexity/risks:** easy demo; medium; identity and source-game trust.
- **Saturation/differentiation/judge appeal:** less finance-like but less economically substantial than PrizeRail.

### 15. CrossLeague — Gaming

- **Problem/user:** multi-game leagues need a neutral, auditable standings and prize layer.
- **Workaround/importance:** platform-specific APIs and manual adjudication; portability is poor.
- **Solution:** registered result adapters feed Creditcoin standings and prize policies through Attestcoin proofs.
- **Creditcoin usefulness:** canonical league state and payouts.
- **Attestcoin necessity:** each result is a source-chain fact, not an API callback.
- **Cross-chain input/source:** Sepolia for MVP, additional chains UNKNOWN.
- **Creditcoin action/flow:** register adapter/result → prove → update standings → settle prize.
- **Business/startup:** league SaaS and per-result fee.
- **Demo/complexity/risks:** compelling expansion but too broad for MVP; high adapter and dispute complexity.
- **Saturation/differentiation/judge appeal:** high originality; execution risk is high.

### 16. LootLease — Gaming/RWA

- **Problem/user:** guilds and players need rentals settled against verified usage or match participation.
- **Workaround/importance:** custodial rentals; defaults and disputes are common.
- **Solution:** Creditcoin escrow releases rental share after a proven match/usage event.
- **Creditcoin usefulness:** escrow, split accounting, and claims.
- **Attestcoin necessity:** binds settlement to exact player and asset event.
- **Cross-chain input/source:** game asset/result contract on Sepolia; production source UNKNOWN.
- **Creditcoin action/flow:** deposit → prove usage → split payment → return asset claim.
- **Business/startup:** rental marketplace fee.
- **Demo/complexity/risks:** medium; asset custody and source authority.
- **Saturation/differentiation/judge appeal:** novel but more moving parts than PrizeRail.

### 17. VerifiedAgentBudget — AI

- **Problem/user:** an AI agent should spend treasury funds only after a verified external trigger.
- **Workaround/importance:** API keys and multisigs; agents can act on stale or manipulated data.
- **Solution:** Creditcoin policy vault accepts a bounded action only when Attestcoin proves the trigger.
- **Creditcoin usefulness:** scoped budget, policy, and one-use execution.
- **Attestcoin necessity:** source event is the non-model authorization predicate.
- **Cross-chain input/source:** approved task/result contract on Sepolia; other chains UNKNOWN.
- **Creditcoin action/flow:** fund budget → prove trigger → execute bounded action → receipt/revoke.
- **Business/startup:** agent safety infrastructure.
- **Demo/complexity/risks:** technically impressive; high; model boundary and policy design.
- **Saturation/differentiation/judge appeal:** AI agent field is crowded; generic framing is weak.

### 18. ProcurementGuard — AI/RWA

- **Problem/user:** procurement agents need proof that a vendor delivered before paying.
- **Workaround/importance:** email/PDF approvals; fraud and duplicate payment risk.
- **Solution:** agent proposes, but Creditcoin pays only after a proven delivery event.
- **Creditcoin usefulness:** escrow and deterministic payment gate.
- **Attestcoin necessity:** canonical delivery receipt controls the payment.
- **Cross-chain input/source:** supplier receipt contract on Sepolia; real ERP integration UNKNOWN.
- **Creditcoin action/flow:** create PO → prove receipt → release → archive evidence.
- **Business/startup:** enterprise SaaS and payment fee.
- **Demo/complexity/risks:** strong business story; medium-high; ERP/source truth integration.
- **Saturation/differentiation/judge appeal:** crowded RWA/AI intersection; moderate.

### 19. ModelBounty — AI

- **Problem/user:** model evaluation bounties need objective acceptance before payouts.
- **Workaround/importance:** centralized benchmark servers; disputes over submissions and scores.
- **Solution:** source benchmark contract records accepted result; Creditcoin releases bounty after proof.
- **Creditcoin usefulness:** bounty escrow and claims.
- **Attestcoin necessity:** result transaction is the acceptance evidence.
- **Cross-chain input/source:** benchmark registry on Sepolia; computation remains off-chain.
- **Creditcoin action/flow:** fund bounty → finalize score → prove → pay winner.
- **Business/startup:** benchmark marketplace fee.
- **Demo/complexity/risks:** similar to PrizeRail but narrower; score-authority risk.
- **Saturation/differentiation/judge appeal:** technically clear, less humanly vivid than gaming.

### 20. TreasurySentinel — AI/DeFi

- **Problem/user:** treasury operators need automatic pauses when a proven risk event occurs.
- **Workaround/importance:** dashboards and human reaction; losses happen between alerts and action.
- **Solution:** Creditcoin policy contract consumes proven source events and pauses spending or changes limits.
- **Creditcoin usefulness:** control plane for treasury policy.
- **Attestcoin necessity:** canonical trigger prevents mutable oracle alerts.
- **Cross-chain input/source:** governance/risk registry on Sepolia; production source UNKNOWN.
- **Creditcoin action/flow:** register policy → prove trigger → pause/limit → admin review.
- **Business/startup:** treasury safety subscription.
- **Demo/complexity/risks:** credible but abstract; medium-high; governance and false-positive risk.
- **Saturation/differentiation/judge appeal:** AI/security submissions overlap; moderate.

## Combination hypotheses

**HYPOTHESIS:** PrizeRail should combine only three reinforcing elements: funded escrow, result proof, and claims/refunds. Adding an AI referee, NFT marketplace, or cross-chain game launcher would dilute the one-product story.

**HYPOTHESIS:** the strongest post-hackathon combination is PrizeRail + a generic result-adapter SDK + tournament-platform API. Those are expansion layers, not MVP requirements.

**FACT:** current visible submissions cluster around lending, collateral, RWA settlement, DePIN receipts, and generic AI agents. Gaming appears materially less populated in the inspected snapshot.

