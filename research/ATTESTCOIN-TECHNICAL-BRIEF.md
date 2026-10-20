# Attestcoin Technical Brief

## Protocol role

**FACT:** Attestcoin is a cross-chain interoperability protocol hosted on Creditcoin. Attestcoin Smart Contracts (ASCs) on Creditcoin can consume proven source-chain transactions (“readability”) and, when released and supported, publish authenticated messages to destination chains (“writability”).

For this hackathon plan, the dependable MVP path is **readability from Ethereum Sepolia to Creditcoin CC3 testnet**.

## Readability

Readability has two layers:

1. Attestors continuously reach consensus on finalized source-chain history and store attestations on Creditcoin.
2. For a selected source transaction, an off-chain prover builds a Merkle inclusion proof and a continuity proof. Creditcoin verifies them synchronously through its native Block Prover precompile.

The proof establishes:

- the encoded transaction/receipt is included in a source block; and
- that block belongs to the attested canonical source-chain history.

It does **not** establish that the transaction succeeded or that its business meaning is acceptable. The ASC must inspect receipt status (`0x1` for success), source chain, expected source contract, relevant event/function, participant identities, values, deadlines, and replay key.

## Verified testnet components

| Component | Verified value |
|---|---|
| Creditcoin testnet EVM chain ID | `102031` |
| Creditcoin testnet RPC | `https://rpc.cc3-testnet.creditcoin.network` |
| Supported source | Ethereum Sepolia |
| Sepolia EVM chain ID | `11155111` |
| Sepolia Attestcoin chain key | `1` |
| Also listed as testnet-readable | Ethereum mainnet, chain key `3` |
| Block Prover precompile | `0x0000000000000000000000000000000000000FD2` |
| ChainInfo precompile | `0x0000000000000000000000000000000000000fd3` |
| Testnet decoder | `0x731c345d79Fb8BbDC541f9DF3b6317585F849F9f` |
| Hosted prover documented in SDK guide | `https://prover.cc3-testnet.creditcoin.network` |
| Alternative environment listing | `https://proof-gen-api.cc3-testnet.creditcoin.network/` (historical/documentation candidate; the implemented USC SDK path uses `https://prover.cc3-testnet.creditcoin.network`) |
| JavaScript/TypeScript SDK | `@gluwa/usc-sdk` with ethers v6 peer dependency |

At runtime, query `ChainInfo` rather than permanently assuming a chain key or supported-chain list.

## SDK flow

The documented SDK flow is:

1. create source-chain and Creditcoin JSON-RPC providers;
2. query supported chains with `PrecompileChainInfoProvider`;
3. locate the source transaction block;
4. wait until the block is attested with `ProofBuilder.waitUntilHeightAttested`;
5. fetch a proof with `getProof(txHash)`;
6. optionally preflight with `PrecompileBlockProver.verifySingle`; and
7. submit the proof to the project ASC, which verifies and executes project logic.

Batch generation/verification supports at most 10 queries sharing a continuity proof and, per SDK documentation, a maximum batch span of 1,000 blocks.

## Capacity and timing

**FACT:** once a block is finalized and attested, proof verification completes synchronously within one Creditcoin block, described as roughly 15 seconds. This is verification time, not the total user wait. Attestation is periodic, and public project reports show real waits of several minutes.

**INFERENCE:** the UI must treat the lifecycle as `mined → awaiting attestation → proof ready → submitting → settled`, persist or reconstruct it by transaction hash, and never promise a 15-second end-to-end flow.

## Builder architecture

A conventional dApp includes:

- a minimal source-chain contract that emits structured events;
- an ASC on Creditcoin that calls `0x0FD2`, decodes verified bytes, and validates business invariants;
- a Creditcoin business-logic contract, separated from verification for nontrivial projects; and
- an off-chain worker that observes source events, waits for attestation, requests proof data, submits it, retries safely, and prevents duplicate work.

Source-chain logic should be minimal; the official pattern recommends concentrating cross-chain business state on Creditcoin.

## Writability status

The protocol and builder marketing describe Outbox/Inbox messaging, attestor quorum signatures, relayers, retryable destination execution, and acknowledgements. However, the technical docs inspected also warn that writability is undergoing third-party testing/audits, and the official examples README says writability examples are “coming soon.”

**Decision:** do not make writability load-bearing in the MVP. It may be an expansion experiment only after confirming current testnet contracts, operator network, fees, and official examples with the team.

## Security checklist for any ASC

- Require the expected Attestcoin chain key.
- Verify through the official precompile address.
- Require successful source receipt status.
- Bind to the expected source contract/emitter.
- Bind to the expected event signature or selector.
- Validate every business parameter, not just inclusion.
- Bind beneficiary identities and amounts.
- Enforce event-specific deadlines and policy state.
- Use a canonical replay key; reject duplicates.
- Make state changes atomic with proof verification.
- Separate proof validity from business validity in logs/UI.
- Fail closed on decode ambiguity, unsupported encoding, RPC disagreement, or missing proof data.

## Primary sources

- [Protocol overview](https://docs.attestcoin.org/attestcoin-protocol)
- [Architecture](https://docs.attestcoin.org/attestcoin-protocol/architecture)
- [Readability](https://docs.attestcoin.org/attestcoin-protocol/attestcoin-readability)
- [Transaction proving](https://docs.attestcoin.org/attestcoin-protocol/attestcoin-readability/step-2-transaction-proving)
- [Builder infrastructure](https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure)
- [Source contracts](https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure/source-chain-smart-contracts)
- [ASC contracts](https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure/attestcoin-smart-contracts)
- [SDK](https://docs.attestcoin.org/attestcoin-protocol/dapp-builder-infrastructure/attestcoin-sdk-usc-sdk)
- [Environments](https://docs.attestcoin.org/attestcoin-protocol/attestcoin-protocol-chains-environments)
- [Builder site](https://attestcoin.org/builder.html)
