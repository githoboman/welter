# PrizeRail Project Constitution

This file is the repository-wide operating contract for PrizeRail. It applies to product, protocol, backend, frontend, research, testing, operations, and submission work. When a local decision conflicts with this file, update the constitution or document the exception explicitly.

## Project Mission

PrizeRail is a proof-bound tournament prize escrow:

- A source-chain game or tournament records a result.
- Attestcoin proves the exact source transaction and canonical history to Creditcoin.
- Creditcoin releases a prefunded prize only to the proven winner.

The product must be described precisely as settlement of a registered on-chain result. It must not claim to prove off-chain gameplay fairness, anti-cheat correctness, or organizer honesty unless a separate mechanism actually proves those properties.

Primary MVP track: Gaming.

MVP path: Ethereum Sepolia readability into Creditcoin CC3 testnet. The source chain and destination chain are implementation facts that must be verified at runtime and recorded in deployment evidence.

### Non-Negotiable Evidence Policy

- Every major product claim must have an independently verifiable artifact.
- Every critical state transition must have explicit evidence.
- Every important failure mode must be tested.
- Never use a mock where a load-bearing real integration is required.
- Never claim functionality that has not been demonstrated end to end.
- Known limitations must be documented explicitly.
- The demo verifier must be reproducible by a third party without private credentials.

## Architecture Rules

- Keep source-chain logic minimal and emit a structured, project-owned result event.
- Prefer a deterministic on-chain reference match for the demo. If an authorized finalizer is used, disclose that trust boundary prominently.
- Creditcoin owns the durable business state: prize policy, reserve, settlement, claim, refund, and replay state.
- Attestcoin readability must be load-bearing. No valid proof means no settlement.
- The Attestcoin proof establishes inclusion and canonical history. The ASC must separately validate receipt success, source contract, event signature, tournament, rules hash, winner, nonce, deadlines, and replay.
- Treat workers, APIs, hosted provers, indexers, and frontends as availability or presentation components, not correctness authorities.
- Keep proof verification and vault accounting in separate contract boundaries with an atomic settlement interface.
- Use immutable or non-upgradeable MVP policy state. An admin must not be able to rewrite a funded tournament’s source, rules, or winner.
- Use pull-based or permissionless-to-trigger claims whose beneficiary is already frozen on-chain. Never trust a caller-supplied payout recipient.
- Protect at least three replay domains: source transaction, business result, and claim.
- Query Attestcoin ChainInfo at runtime. Do not assume that an EVM chain ID is the same as an Attestcoin chain key.
- Attestcoin writability, arbitrary multi-chain adapters, AI adjudication, NFTs, and production custody are outside the MVP unless this constitution is deliberately amended with evidence and scope review.

## Coding Rules

- Do not fabricate SDK methods, decoder interfaces, contract addresses, chain IDs, RPC endpoints, or protocol behavior. Mark uncertain items `UNKNOWN` and create a verification task.
- Keep protocol, accounting, worker, API, and UI responsibilities explicit. Avoid abstractions that hide trust or money movement.
- Use typed, validated data at boundaries. Treat transaction hashes, addresses, amounts, chain keys, event fields, and deadlines as untrusted input until validated.
- Represent evidence outcomes explicitly as `PASS`, `FAIL`, or `UNKNOWN`; do not collapse infrastructure uncertainty into success or business invalidity.
- Make retries idempotent and check chain state before resubmitting a timed-out transaction.
- Never place private keys, credentials, provider tokens, database URLs, or session secrets in browser code, committed files, logs, screenshots, fixtures, or demo artifacts.
- Keep comments focused on non-obvious invariants, trust boundaries, and failure handling. Do not copy implementation from competitors or official examples.
- Keep changes narrowly scoped. Do not mix unrelated refactors, generated metadata, or formatting churn into a product change.

## Testing Rules

- Every critical state transition must have explicit evidence.
- Every important failure mode must be tested.
- Unit-test contract state transitions, authorization, accounting, deadlines, and replay invariants.
- Use integration tests for source event decoding, Attestcoin proof handling, precompile interaction, vault settlement, and worker/API correlation.
- A local mock may support fast unit tests, but never use a mock where a load-bearing real integration is required.
- Before claiming protocol support, run a real Sepolia-to-CC3 smoke path using the documented Attestcoin flow.
- Test wrong chain, wrong chain key, failed receipt, wrong source contract, wrong event, wrong tournament, wrong rules hash, wrong winner, invalid nonce, expired policy, unfunded vault, duplicate result, replay, double claim, unauthorized refund, RPC timeout, prover outage, and submission timeout.
- Add fuzz or property tests for funds conservation, immutable active policy, at-most-once settlement, at-most-once claim, and concurrent/retried submission.
- Preserve at least one completed historical run that a judge can inspect if live infrastructure is slow.
- Never claim functionality that has not been demonstrated end to end. A passing unit test is not evidence of a live cross-chain integration.

## Security Rules

- Verify the exact expected Attestcoin precompile and source chain key.
- Require source receipt status `0x1`; inclusion alone is insufficient.
- Bind proofs to the expected source contract and event selector/signature.
- Validate every business field needed for payout, including tournament ID, rules hash, winner, result nonce, amount/policy, and deadline.
- Consume replay keys and update payout state atomically with proof verification.
- Apply access control, checks-effects-interactions, non-reentrancy, safe token handling, and explicit pause/refund policy where relevant.
- The worker may submit a proof but may not choose the winner, alter policy, bypass replay checks, or authorize money movement.
- Use dedicated, testnet-only wallets with minimum balances. Separate deployer, worker, organizer/finalizer, and winner roles where practical.
- Run dependency, static-analysis, fuzz, and secret scans before publication. Record unresolved findings and residual risk.
- Known limitations must be documented explicitly, especially source-finalizer authority, test-token value, hosted prover availability, attestation latency, and testnet status.

## UX Rules

- Make the primary loop legible: fund, record result, await proof, settle, claim, replay fails.
- Show asynchronous states explicitly: `MINED`, `AWAITING_ATTESTATION`, `PROOF_READY`, `SUBMITTING`, `CLAIMABLE`, `CLAIMED`, `REFUNDABLE`, `REFUNDED`, `FAIL`, and `UNKNOWN`.
- Never promise instant payout or a fixed end-to-end time when attestation is asynchronous.
- Display the source transaction, decoded predicates, destination settlement, claim/refund state, and explorer links.
- Explain what the proof does and does not establish in product copy and demo narration.
- Make refresh/reconnect recover the flow from the source transaction hash or job ID.
- Keep organizer, finalizer, worker, and winner actions visibly distinct. Do not hide custody or privileged roles.
- Design for a short judge path, mobile-readable layouts, keyboard access, clear transaction rejection states, and no private credential requirement.
- Visual polish supports comprehension; it cannot compensate for a generic problem, mocked protocol path, or missing evidence.

## Research Rules

- Prefer primary sources: official hackathon pages, Creditcoin/Attestcoin documentation, official repositories, explorers, and project-owned evidence.
- Separate `FACT`, `INFERENCE`, `HYPOTHESIS`, and `UNKNOWN` in research and decision documents.
- Record research snapshots and URLs for time-sensitive claims such as deadlines, supported chains, endpoints, prizes, and competitor listings.
- Do not silently substitute identities, repositories, products, or technical interfaces when a requested source is unavailable or ambiguous.
- Treat competitor READMEs and deployment claims as self-reported unless independently inspectable.
- Learn from architecture and product patterns without copying code, protected content, branding, or distinctive game mechanics.
- Update the thesis when evidence changes. Do not preserve a preferred idea merely because implementation has started.

## Git Rules

- Preserve user changes and unrelated work. Never reset, checkout, or delete broad paths to simplify a task.
- Review the diff and status before and after every substantive change.
- Keep commits small and coherent when a Git repository exists; commit messages should describe the decision or behavior changed.
- Do not commit private keys, secrets, local databases, build output, or unreviewed generated artifacts.
- Every deployed-address or evidence claim must include the relevant chain, transaction hash, block, and source/configuration reference.
- A clean working tree is not proof of correctness; tests, live evidence, and verifier output are required.

## Environment Rules

- Maintain `.env.example` and `research/ENVIRONMENT-CONTRACT.md` whenever configuration changes.
- Every environment variable must document purpose, required/optional status, source, format, frontend exposure, server-only status, and missing-variable behavior.
- Prefix browser-exposed variables deliberately and assume all such values are public.
- Keep worker/deployer keys, database credentials, session secrets, and keyed RPC URLs server-side only.
- Use documented testnet RPCs, chain IDs, faucets, and endpoints. Verify endpoint compatibility before implementation.
- A third-party verifier must run with public RPC access and no private credentials. It must not perform writes.
- If a provider requires an API key, add it explicitly to the environment contract and ensure the public verifier has a keyless fallback or documented read-only alternative.

## Definition of Done

A product or milestone is done only when all applicable conditions are true:

- The behavior is implemented within the approved scope and trust model.
- Major claims have independently verifiable artifacts.
- Critical state transitions have transaction/event/test evidence.
- Important failure modes have automated or reproducible tests.
- Load-bearing integrations use the real target protocol and testnet path.
- End-to-end behavior has been demonstrated, not inferred from mocks or isolated tests.
- Contract addresses, ABIs/configuration, hashes, blocks, timing, and limitations are documented.
- The no-key demo verifier works from a fresh checkout or documented command path.
- Security, secret, dependency, and accessibility checks are recorded.
- The change is reflected in the relevant research, architecture, environment, or implementation-plan artifact.

## Known Anti-Patterns

- SDK import without a proof-controlled business outcome.
- Treating receipt success or transaction inclusion as proof of business meaning.
- Accepting arbitrary user-submitted transaction hashes without source/event/policy binding.
- Calling PrizeRail a bridge, oracle, trustless gameplay system, or instant payout rail.
- Letting an organizer-controlled finalizer choose a winner while implying the result is independently fair.
- Hiding a mock, fixture, manually injected result, or privileged backdoor inside a load-bearing demo path.
- Adding AI, NFTs, lending, identity, multi-chain support, writability, or game-marketplace features before the core settlement path is proven.
- Using screenshots without public hashes, addresses, block numbers, and reproducible verification.
- Treating `UNKNOWN` infrastructure state as `PASS` or terminal business `FAIL`.
- Claiming “any chain,” “production-ready,” “audited,” “non-custodial,” or “permissionless” without direct evidence.

## Session Handoff Protocol

Every substantial session must leave enough information for another agent to continue without reconstructing hidden context. Record:

1. **Objective and phase:** the exact task and whether work is research, spike, implementation, testing, deployment, or submission.
2. **Completed work:** files changed and decisions made.
3. **Evidence:** commands, test results, transaction hashes, explorer links, screenshots, or verifier output. Distinguish live, simulated, mocked, and planned evidence.
4. **Known unknowns:** unresolved protocol/API/environment questions and their next verification step.
5. **Risks and blockers:** security, schedule, infrastructure, product, or judging risks; do not hide uncertainty.
6. **Next action:** one concrete, dependency-aware action that advances the approved objective.
7. **Environment state:** required services, processes, ports, testnet wallets, and safe configuration notes; never include secrets.
8. **Scope check:** explicitly list anything deferred or rejected so the next session does not reintroduce it accidentally.

The handoff is complete only when the repository itself contains the durable decision or evidence needed to verify the status.
