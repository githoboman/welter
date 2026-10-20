# Executive Summary

Research snapshot: 2026-09-08.

1. **What the hackathon rewards:** a testnet-deployed, original product with working, meaningful Attestcoin integration. Depth of Attestcoin use is the only explicit scoring signal; no numeric organizer rubric was published. A strong submission also needs a clear real-world problem, live evidence, security, documentation, deck, video, and public repository.
2. **What Creditcoin appears to want:** applications that make Creditcoin the durable cross-chain policy and execution hub, create repeat blockspace/state usage, demonstrate proof beyond bridges/oracles, and can mature into CEIP-backed companies.
3. **What Attestcoin uniquely does:** it lets a Creditcoin contract verify that a source transaction was included in attested canonical history. It does not prove receipt success or business truth by itself; the ASC must validate those semantics.
4. **Competitive landscape:** lending, credit scoring, collateral, RWA finance, DePIN receipts, and generic AI-agent uses are crowded. The visible BUIDL Gaming field is sparse, although the user-provided ROPES reference shows that adjacent gaming products can set a high bar for on-chain evidence and UX.
5. **Biggest gaps:** proof-bound game/economic settlement, deterministic security gates around verified events, and simple products that expose negative-path evidence rather than broad dashboards.
6. **Top five:** PrizeRail, CovenantPay, EscrowedRemit, SignalSLA, and ModelBounty.
7. **Winner:** **PrizeRail**, a proof-bound tournament prize escrow in the Gaming track—not another prediction game; ROPES is treated as an adjacent UX/evidence benchmark.
8. **Why it wins:** it is narrow, memorable, relatively differentiated, feasible with readability, and gives both protocols indispensable roles. Demo: fund → finalize on Sepolia → prove → settle on Creditcoin → claim → replay fails.
9. **Attestcoin role:** prove the exact successful `MatchFinalized` transaction and canonical history; the ASC checks chain, source registry, receipt status, event, tournament, winner, rules hash, nonce, deadlines, and replay.
10. **Creditcoin role:** hold the prize reserve and immutable policy; execute settlement, claim/refund, accounting, and replay protection.
11. **MVP:** one Sepolia result registry, one CC3 proof-verifying ASC, one CC3 prize vault, a resumable proof worker/API, a minimal lifecycle UI, negative tests, explorer evidence, and a no-key verifier.
12. **Environment:** Sepolia and CC3 RPCs/chain IDs; Attestcoin chain key, prover, Block Prover, ChainInfo, and confirmed decoder; deployed addresses; server-only worker/deployer keys; durable database; optional session/telemetry settings. Exact definitions are in [ENVIRONMENT-CONTRACT.md](./ENVIRONMENT-CONTRACT.md).
13. **Architecture:** source registry → Attestcoin proof worker/prover → Creditcoin ASC/native verifier → vault → winner pull claim; relational state caches jobs/evidence while chains remain authoritative.
14. **Biggest technical risks:** proof/SDK version uncertainty, attestation latency, receipt decoding/gas, replay/concurrency, hosted RPC/prover availability, and source-finalizer authority.
15. **Biggest judging risks:** appearing to claim gameplay fairness, looking like a renamed bridge, hiding mocked components, failing to make proof load-bearing, or presenting only a happy path.
16. **Build first:** query ChainInfo, prove one known Sepolia transaction, decode a project-owned result, and demonstrate wrong-source/event/status/replay rejection before investing in UI.
17. **Explicitly avoid:** Attestcoin writability in MVP, AI referees, multi-chain adapters, lending/credit sprawl, NFTs, real-value assets, mainnet deployment, and any “trustless gameplay” or “instant payout” claim.
