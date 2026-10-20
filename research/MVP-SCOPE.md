# MVP Scope

## Must ship

- Sepolia `TournamentResultRegistry` with deterministic authorized finalizer and `MatchFinalized` event.
- Creditcoin `PrizeVault` with funding, policy, claimable, claimed, refund, and replay state.
- Creditcoin ASC that verifies Attestcoin proof and validates receipt/event semantics.
- Worker/API that tracks transaction hash, attestation wait, proof readiness, submission, and retries.
- Minimal frontend: create/fund tournament, show result/proof lifecycle, settle, claim, and replay failure.
- Testnet deployment metadata, explorer links, README, threat model, environment contract, and negative-path evidence.

## Competitive layer

- Explicit `PASS/FAIL/UNKNOWN` evidence status.
- No-key read-only verifier.
- Separate source-result authority disclosure.
- Idempotent worker and canonical replay key across source transaction, tournament, result nonce, and claim.
- Pull-based claim rather than an unbounded automatic transfer.
- Historical run that judges can inspect if live attestation is slow.

## Expansion layer

- A stable source-adapter interface and second officially supported source chain.
- Tournament-platform API/webhooks, multi-match and season accounting, studio/operator roles, configurable testnet prize assets, embeddable claim pages, and dispute evidence bundles.
- Audited production deployment, custody/compliance integrations, and any future Attestcoin writability path only after protocol readiness and legal/security review.

## Excluded from MVP

- Writability, bridge messaging, or relayer claims.
- Multiple source chains or arbitrary game adapters.
- AI adjudication, anti-cheat, NFTs, fiat payments, or production custody.
- Mainnet deployment.
