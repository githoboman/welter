# Technical Constraints

## Hard competition constraints

- The project must be original hackathon-period work.
- It must run on a testnet.
- Attestcoin must be a core, functional integration.
- Technical documentation must explain the setup and protocol use.
- Public source, README, deck/whitepaper, and demo video are required.

## Verified network constraints

- Destination/control chain: Creditcoin CC3 testnet, EVM chain ID `102031`.
- Demonstration source chain: Ethereum Sepolia, EVM chain ID `11155111`, Attestcoin chain key `1`.
- The chain key is not the EVM chain ID and must be runtime-checked.
- Creditcoin gas is paid in testnet CTC acquired through the Discord faucet.
- The read path depends on both a source RPC and Creditcoin RPC.
- Proof construction depends on source finality, Attestcoin attestation, and a prover or locally operated raw proof builder.
- Hosted prover/RPC availability is outside project control.

## Protocol constraints

- A valid proof proves inclusion and canonical history, not semantic correctness.
- Receipt status must be checked by the ASC.
- Transaction decoding and event/selector checks are project responsibilities.
- Replay protection is project responsibility.
- Verification can be synchronous once proof data exists, but attestation introduces an asynchronous wait before that point.
- Batch verification is capped at 10 proofs with the documented SDK constraints.
- Official docs and examples are educational; production readiness requires independent review.

## Product constraints for PrizeRail

- Attestcoin does not prove an off-chain esport result is honest. It proves the authoritative source-chain transaction occurred. The tournament/game contract’s authority remains a separate trust boundary.
- MVP therefore uses a deterministic on-chain source tournament result, or a clearly identified authorized match finalizer. It must not claim to prove physical/off-chain gameplay.
- The result proof must bind tournament ID, source registry, winner address, rules hash, and result nonce.
- PrizeRail must never pay merely because an arbitrary successful Sepolia transaction was proven.
- Prize currency is a mock ERC-20 with no monetary value for testnet.
- Cross-chain payout back to Sepolia is excluded; the winner claims on Creditcoin.

## Delivery constraints

- A judge should be able to inspect a completed historical run even if the prover is slow during judging.
- A fresh live flow must be resumable from the source transaction hash.
- All contract addresses, transaction hashes, build results, and limitations must be machine-readable and human-readable.
- No private key may enter the browser bundle, repository, logs, or evidence files.
- A read-only verification path must require no secrets and perform no writes.

## Unknowns to resolve before implementation

- Current package versions of `@gluwa/usc-sdk` and compatible decoder/contracts libraries.
- Whether `ASCBase` shown on the newer builder site is released and recommended over the lower-level SDK/example interface.
- Exact gas behavior for PrizeRail’s receipt decoder and proof payload.
- Current source-chain attestation interval under hackathon load.
- Whether official writability is production-ready on CC3 testnet. It is non-MVP regardless.
- Any organizer clarification on allowed pre-hackathon scaffolding.

## Risk-reduction experiments (before full build)

1. Query `0x0FD3` and confirm Sepolia chain key/support.
2. Prove one known successful Sepolia transaction and verify it through `0x0FD2`.
3. Decode one project-owned `MatchFinalized` receipt on Creditcoin.
4. Demonstrate rejection for wrong source contract, wrong event, failed receipt, and replay.
5. Measure attestation latency and proof payload/gas.

These experiments are implementation milestones, not work to perform during this planning phase.

## Sources

- [Attestcoin architecture](https://docs.attestcoin.org/attestcoin-protocol/architecture)
- [SDK](https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure/attestcoin-sdk-usc-sdk)
- [Builder infrastructure](https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure)
- [CC3 testnet](https://docs.creditcoin.org/environments/testnet)
- [Hackathon rules](https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail)
