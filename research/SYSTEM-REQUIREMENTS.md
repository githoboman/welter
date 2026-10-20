# System Requirements

## Functional requirements

### Frontend

- Connect a wallet and enforce the active chain for each action.
- Create/view a tournament policy and show funded balance on Creditcoin.
- Finalize a deterministic result on Sepolia for the demo operator role.
- Resume the proof flow from a source transaction hash.
- Display `MINED`, `AWAITING_ATTESTATION`, `PROOF_READY`, `SUBMITTING`, `CLAIMABLE`, `CLAIMED`, `REFUNDABLE` (UI concept before organizer refund), `REFUNDED`, and terminal failure states.
- Show explorer links, decoded predicates, and replay status.
- Never expose a worker/deployer private key.

### Backend/worker

- Observe or accept an allowlisted source transaction hash.
- Validate basic source receipt/event shape before requesting a proof.
- Query ChainInfo at startup; fail closed if Sepolia support differs from configured expectations.
- Wait for attestation, request proof, preflight when supported, submit settlement, and retry idempotently.
- Persist jobs, attempts, timestamps, error classes, and resulting transaction hashes.
- Expose read-only status/evidence endpoints; authorization is optional for MVP operator actions if wallet signatures are used.

### Authentication and wallet requirements

- Organizer/finalizer and winner use distinct EVM accounts in the demo; a dedicated worker/deployer testnet account is separate from browser wallets.
- Direct contract writes are authorized by wallet signatures and on-chain roles/state.
- Read-only evidence endpoints require no authentication.
- If administrative API sessions are enabled, use nonce-bound EIP-191/EIP-712 wallet challenges with expiration and replay prevention; exact library/schema remains `UNKNOWN` until the stack is selected.
- Wallet UI must prevent accidental mainnet use, show address/role clearly, and require explicit network switching between Sepolia and CC3.

### Contracts

- `TournamentResultRegistry` on Sepolia: register an immutable tournament rules hash and finalize one result per tournament under explicit authority.
- `PrizeRailASC` on Creditcoin: verify proof, decode receipt/log, enforce all source/business predicates, consume replay key, and call vault settlement atomically.
- `PrizeVault` on Creditcoin: create policy, accept funding, mark claimable, allow winner claim, allow policy-bound refund, and preserve accounting invariants.
- Test token may be an existing faucet token or project-owned mock ERC-20; the chosen address must be documented as having no monetary value.

## Data and integration requirements

- Source identifiers: Sepolia chain ID `11155111`, Attestcoin chain key queried at runtime (expected `1`).
- Destination: Creditcoin CC3 chain ID `102031`.
- Attestcoin precompiles: Block Prover `0x0000000000000000000000000000000000000FD2`; ChainInfo `0x0000000000000000000000000000000000000fd3`.
- Store tournament policy, result transaction hash, source block, proof/settlement hashes, claim hash, replay key, decoded evidence, and lifecycle timestamps.
- Database: SQLite/PostgreSQL-compatible relational store is sufficient; in-memory-only state is not acceptable for a resumable demo.
- Indexing: direct RPC log scanning is sufficient for MVP; a hosted indexer is optional and must not be load-bearing.

## Transaction and event flow

1. Organizer creates/funds tournament on CC3.
2. Players commit/reveal; the authorized finalizer sends the Sepolia `finalize` transaction after both reveals or the deadline.
3. Registry emits result event.
4. Worker waits for attestation and obtains proof.
5. ASC validates proof and event semantics and settles vault.
6. Vault emits claimable event.
7. A winner or worker triggers permissionless `claimFor`; the vault pays the frozen winner and emits `PrizeClaimed`.

## Verification flow

1. Worker retrieves the source receipt and checks that the transaction exists, is successful, and contains the expected emitter/event shape as an early fail-fast check.
2. Worker queries ChainInfo, waits until the source block is attested, obtains the Merkle + continuity proof, and optionally preflights it.
3. Worker or user submits the proof payload to `PrizeRailASC`.
4. The ASC invokes the native Block Prover and treats only its verified transaction/receipt bytes as authoritative.
5. The ASC repeats receipt status, source contract, event signature, tournament ID, rules hash, winner eligibility, result nonce, policy, deadline, and replay checks on-chain.
6. Only after every predicate passes does the ASC consume replay keys and settle the vault atomically.

## Failure handling

- Unsupported chain, wrong chain key, RPC disagreement, malformed proof, failed source receipt, wrong source contract/event/fields, expired policy, duplicate result, replayed transaction, unfunded vault, wrong claimant, and claim transfer failure must fail closed.
- Transient RPC/prover errors retry with bounded exponential backoff and retain an inspectable `UNKNOWN` state.
- Business-invalid proofs are terminal `FAIL`; infrastructure uncertainty is `UNKNOWN`, never `PASS`.

## Security boundaries

- Attestcoin establishes transaction inclusion/history, not source-finalizer honesty or gameplay fairness.
- Worker is untrusted for correctness; contracts revalidate all predicates.
- Organizer may define policy before funding but cannot change result predicates after activation.
- Winner uses pull payment; no arbitrary external call during settlement.
- Checks-effects-interactions, access control, pause/refund policy, and non-reentrancy apply where relevant.

## Test requirements

- Unit tests for state transitions and accounting invariants.
- Integration tests against local contract doubles plus a real CC3/Sepolia smoke path.
- Negative tests: wrong chain, source, event, tournament, winner, rules hash, nonce, failed receipt, expired policy, duplicate finalization, replay, double claim, unauthorized refund.
- Property/fuzz tests: funds conservation, at-most-once settlement, at-most-once claim, immutable active policy.
- Evidence test: no-key command reconstructs and compares the completed live run.

## Deployment requirements

- Sepolia and CC3 contracts deployed and source-verified if explorer support permits.
- Machine-readable deployment manifest with addresses, chain IDs, block numbers, transaction hashes, compiler settings, and Git commit.
- Worker and frontend deployment URLs are optional organizer details but strongly recommended for judging.
