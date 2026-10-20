# Frontend Contract

Status: frozen against the deployed Sepolia/CC3 contracts and the local worker/read API as of 2026-09-13.

The frontend under `frontend/` implements the asynchronous read boundary and a deliberate organizer policy create/approve/fund
flow against the selected deployed ABI. The preserved pre-hardening live run in `evidence/worker-live-2026-09-11T22-00-53-430Z.json`
remains historical provenance; current-code restart/reconciliation closure is recorded in
[`evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json`](../evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json).
The API is not hosted and no public availability claim is made. Browser transaction support is implemented but has not been
demonstrated with a real wallet extension or live write in this environment.

## Authoritative deployment

| Network | Chain ID | Attestcoin key | Contract | Address | Explorer base |
|---|---:|---:|---|---|---|
| Ethereum Sepolia | 11155111 | 1 (runtime-confirmed by ChainInfo) | `TournamentResultRegistry` | `0xDdDA859AC766E3eaE59Dc7b7B85465610aF90a3f` | `https://sepolia.etherscan.io/tx/` |
| Creditcoin CC3 | 102031 | n/a | `MockPrizeToken` | `0x9366e8298799A132D20F51021d6Ef3A99D57817C` | `https://creditcoin-testnet.blockscout.com/tx/` |
| Creditcoin CC3 | 102031 | n/a | `PrizeVault` | `0x270B97d063668d9B2107d15E08a81Af2318E7edC` | `https://creditcoin-testnet.blockscout.com/tx/` |
| Creditcoin CC3 | 102031 | n/a | `PrizeRailASC` | `0xD5226c2eC2C6958A9785C29DADBc28810f718CCf` | `https://creditcoin-testnet.blockscout.com/tx/` |

The current deployment selector is [`evidence/current-deployment.json`](../evidence/current-deployment.json), which points to the post-fix versioned manifest. The historical three-run deployment remains in [`evidence/live-deployment.json`](../evidence/live-deployment.json). All addresses are testnet-only and the prize token has no monetary value.

## Read contract

Reads are public, do not require a wallet, and can be performed with a public RPC. A frontend must treat an RPC timeout, missing receipt, or inconsistent response as `UNKNOWN` or `INFRASTRUCTURE_UNAVAILABLE`, never as a business failure.

| Read | Input | Output and displayable evidence |
|---|---|---|
| `TournamentResultRegistry.sourceChainId()` | none | Source chain ID; expected `11155111`. |
| `TournamentResultRegistry.finalizer()` | none | Address allowed to call `createMatch`; this is not an exclusive finalization role. |
| `TournamentResultRegistry.matches(matchId)` | `bytes32 matchId` | Tournament, players, rules hash, deadline, commit/reveal flags, derived winner/result/status, nonce, and `finalizedAt`. |
| `PrizeVault.policies(tournamentId)` | `bytes32 tournamentId` | Organizer, source chain key, policy-bound source registry, rules hash, token, amount, deadlines, frozen winner/nonce/query key, and numeric state (`0 DRAFT`, `1 FUNDED`, `2 CLAIMABLE`, `3 CLAIMED`, `4 REFUNDED`). |
| `PrizeVault.settlementAuthority()` | none | The deployed ASC address expected to call `settle`. |
| `PrizeRailASC.expectedSourceChainKey()` | none | Expected Attestcoin chain key (`1`). |
| `PrizeRailASC.vault()` | none | Vault address bound into the ASC. |
| `PrizeRailASC.usedSourceQueries(queryKey)` / `usedBusinessResults(businessKey)` / `processedQueries(queryId)` | `bytes32` key | Replay-consumption evidence. |
| Token `balanceOf(address)` | address | Test-token balance. Never present this as real value. |

The local read endpoint is `/api/v1`; it may cache operational state, but the chain remains authoritative.

## User-visible operations

Each operation below states the actual current behavior. `PASS`, `FAIL`, and `UNKNOWN` are evidence outcomes; UI labels must not collapse infrastructure uncertainty into a terminal business failure.

### 1. Create a source match

- **Input:** `tournamentId`, `matchId`, `playerOne`, `playerTwo`, `rulesHash`, future `revealDeadline`.
- **Call:** `TournamentResultRegistry.createMatch(...)` on Sepolia.
- **Wallet:** required; caller must equal the contract's `finalizer` address.
- **Permissionless:** no. Only `finalizer` may create matches.
- **State:** no match -> match created, not finalized. The match may be called `MATCH_PENDING`/`MATCH_ACTIVE` depending on commit/reveal progress.
- **Pending:** wallet signs; wait for Sepolia receipt.
- **Success:** receipt status `1`, `MatchCreated` event, and `matches(matchId)` populated.
- **Failure:** wallet rejection, wrong chain, invalid IDs/players/deadline, duplicate match, or unauthorized caller. These are transaction failures and should expose the revert reason when decodable.
- **Retry:** retry only after checking the receipt and `matches(matchId)`. A duplicate retry is expected to fail.
- **Timeout:** query the transaction hash before resubmitting; the SPA observes wallet/account/network state but does not
  submit this transaction. The local worker reconciles its own submitted settlement and payout hashes.
- **Evidence:** transaction hash, block, gas, event fields, explorer URL.
- **Attestcoin/Creditcoin:** neither.

### 2. Commit a move

- **Input:** `matchId`, `keccak256(abi.encode(choice, salt))`.
- **Call:** `TournamentResultRegistry.commit(...)` on Sepolia.
- **Wallet:** required; caller must be `playerOne` or `playerTwo` and may commit once before the deadline.
- **Permissionless:** no; player-bound.
- **State:** match remains active; one player's commit flag becomes true.
- **Reveal ordering:** post-fix source bytecode requires both players to commit before either player can reveal.
- **Pending/success/failure/retry/timeout:** same Sepolia transaction rules as create; inspect `matches(matchId)` before retrying.
- **Evidence:** `MoveCommitted` event, receipt hash, block/gas, and Sepolia explorer URL.
- **Attestcoin/Creditcoin:** neither.

### 3. Reveal a move

- **Input:** `matchId`, choice `1=Rock`, `2=Paper`, `3=Scissors`, salt matching the caller's commitment.
- **Call:** `TournamentResultRegistry.reveal(...)` on Sepolia.
- **Wallet:** required; caller must be the committing player.
- **Permissionless:** no; player-bound.
- **State:** caller's reveal flag becomes true after both players have committed. The second reveal can complete the match's reveal phase.
- **Success:** receipt status `1`, `MoveRevealed` event, and matching `matches(matchId)` fields.
- **Evidence:** `MoveRevealed` event, receipt hash, block/gas, matching `matches(matchId)` fields, and Sepolia explorer URL.
- **Failure:** bad choice, missing/duplicate commit or reveal, commitment mismatch, late reveal, wrong player, wrong chain, or wallet rejection.
- **Retry:** only after reading the match flags; a successful reveal must not be repeated.
- **Attestcoin/Creditcoin:** neither.

### 4. Finalize the source result

- **Input:** `matchId`.
- **Call:** `TournamentResultRegistry.finalize(matchId)` on Sepolia.
- **Wallet:** required for gas, but **any address may call it**. The contract has no `onlyFinalizer` guard on `finalize`.
- **Permissionless:** yes, once both players have revealed or `block.timestamp > revealDeadline`.
- **State:** active -> finalized. The contract derives the result; the caller cannot provide a winner.
- **Success:** `MatchFinalized` receipt status `1`; result is normal win/draw when both revealed, or timeout win/draw after the deadline. The nonce is `keccak256(abi.encode(matchId))`.
- **Settlement implication:** a draw (normal or timeout) is a valid source result but has no winner and is deliberately non-payable by the deployed ASC; it cannot advance a funded prize to `CLAIMABLE`.
- **Failure:** unknown match, already finalized, or premature finalization when both reveals are not complete and the deadline has not passed.
- **Retry:** read `matches(matchId)` first. A finalized match must not be resubmitted.
- **Evidence:** source transaction hash, block, gas, decoded event, source contract, chain ID, rules hash, winner/result/status, nonce, deadline/finalized timestamp, explorer URL.
- **Attestcoin/Creditcoin:** neither at this step.
- **Trust limitation:** the finalizer remains privileged for match creation. `finalize` itself is permissionless; UI copy must not claim that only the finalizer can finalize.

### 5. Create and fund a prize policy

- **Input:** `tournamentId`, organizer, source chain key, source registry, rules hash, token, amount, settlement deadline, refund deadline.
- **Calls:** `PrizeVault.createTournament(...)`, then token `approve(vault, amount)`, then `PrizeVault.fund(tournamentId)` on CC3. The current live script also calls public `MockPrizeToken.mint` to obtain test tokens.
- **Wallet:** organizer wallet is required for policy creation and funding; token approval is also organizer-authorized.
- **Permissionless:** no for create/fund. The token's test `mint` is publicly callable, but it is not a production funding mechanism and must not be presented as one.
- **State:** no policy -> `DRAFT` -> `FUNDED`.
- **Success:** receipts status `1`, `TournamentCreated`/`TournamentFunded`, and `policies(tournamentId).state == FUNDED`.
- **Failure:** invalid policy/deadline, duplicate ID, organizer mismatch, insufficient token balance/allowance, wrong chain, wallet rejection, or transaction timeout.
- **Retry:** check policy state, allowance, and vault token balance before repeating. Do not infer funding from a submitted hash alone.
- **Evidence:** policy fields, funding transaction hashes, amount, token address, block/gas, explorer URLs.
- **Attestcoin:** no. **Creditcoin:** yes.
- **Registry allowlisting limitation:** the vault accepts any nonzero `sourceRegistry`; the ASC only compares the proof emitter with the policy's value. There is no global deployed-registry allowlist. The worker/API admission boundary rejects jobs outside the selected deployed registry, while direct contract callers remain subject to the contract limitation.

### 6. Request/provide Attestcoin proof

- **Current input:** source `MatchFinalized` transaction hash and expected chain key `1` to `scripts/complete-live-run.ts` or `scripts/live-e2e.ts`.
- **Current output:** SDK proof payload, header number, proof digest (`keccak256(encodedTransaction)` in evidence), `verified` preflight result, and latency.
- **Current interface:** the local worker/API exposes durable job IDs and browser-safe read routes; the service is not hosted,
  and raw proof bytes remain server-side.
- **Wallet:** proof construction/preflight itself does not need a wallet; settlement submission later needs a CC3 signer.
- **Permissionless:** protocol submission is permissionless, but the current scripts require `WORKER_PRIVATE_KEY` for submission and claim.
- **States:** source mined -> `AWAITING_ATTESTATION` -> proof returned -> preflight `PASS`/`FAIL`/`UNKNOWN`.
- **Pending:** hosted prover wait may be seconds or many minutes. Observed runs were about 12.6s, 20.0s, and 539.9s; no SLA exists.
- **Failure:** source not mined/failed, ChainInfo mismatch, prover/RPC outage, malformed proof, or native preflight rejection.
- **Retry:** query source receipt and existing chain state before requesting again; the worker persists a resumable job record, leases, retry metadata, and submitted transaction hashes.
- **Evidence:** proof header, digest, cached flag, preflight result, latency. Raw proof bytes are not in the public evidence bundle.
- **Attestcoin:** yes. **Creditcoin:** ChainInfo and native Block Prover preflight.

### 7. Submit proof and settle

- **Input:** action `0`, chain key, block height, encoded transaction, Merkle root/siblings, continuity digest/roots.
- **Call:** `PrizeRailASC.verifyAndSettle(...)` on CC3. The inherited `ASCBase.execute(...)` is also externally callable, but it is not the evidenced/canonical frontend entrypoint and exposes generic revert strings.
- **Wallet:** any CC3 wallet with gas; no caller authorization is checked by the ASC. The current script uses the worker wallet.
- **Permissionless:** yes in protocol terms; a valid proof and policy predicates authorize settlement, not caller identity.
- **State:** `FUNDED` -> `CLAIMABLE` if native proof and all semantic checks pass.
- **Checks:** expected chain key, native proof, receipt status `1`, `MatchFinalized` signature, policy tournament/source registry/rules hash, Sepolia chain ID, nonce, valid result/status/winner, settlement deadline, source replay, business replay, then atomic vault settlement.
- **Pending:** wait for CC3 transaction receipt; a submitted hash is not settlement success.
- **Success:** receipt status `1`, `ResultVerified`, `TournamentSettled`, policy state `CLAIMABLE`.
- **Failure:** custom errors such as `WrongChain`, `FailedReceipt`, `MissingEvent`, `WrongSource`, `WrongRules`, `WrongWinner`, `InvalidFinalization`, `Expired`, `ReplaySource`, `ReplayBusiness`, or vault state failure.
- **Retry:** inspect the receipt and policy/replay mappings before resubmitting. A timed-out submission may have mined.
- **Evidence:** settlement hash, CC3 block/gas, `ResultVerified`, `TournamentSettled`, policy state, replay keys, explorer URL.
- **Attestcoin/Creditcoin:** both.

### 8. Claim the prize

- **Input:** `tournamentId` only.
- **Call:** `PrizeVault.claimFor(tournamentId)` on CC3.
- **Wallet:** any CC3 wallet with gas. The winner is read from the frozen policy; the caller cannot choose a recipient.
- **Permissionless:** yes.
- **State:** `CLAIMABLE` -> `CLAIMED`; token transfer goes to the frozen `policy.winner`.
- **Success:** receipt status `1`, `PrizeClaimed`, policy state `CLAIMED`, winner token balance increases.
- **Failure:** policy not claimable, token transfer failure, reentrancy guard, wrong chain, wallet rejection, or timeout.
- **Retry:** read policy state and token balance before retrying; a successful claim must not be repeated.
- **Evidence:** claim hash, block/gas, event winner/amount, post-claim state/balance, explorer URL.
- **Attestcoin:** no new proof; claim depends on prior settlement. **Creditcoin:** yes.

### 9. Refund or recover expiry

- **Input:** `tournamentId`.
- **Normal call:** `PrizeVault.refund(tournamentId)`; organizer only during `settlementDeadline < timestamp <= refundDeadline`.
- **Recovery call:** `PrizeVault.recoverExpired(tournamentId)`; permissionless only after `refundDeadline` while still `FUNDED`.
- **Beneficiary:** both operations always transfer to the immutable organizer; the trigger cannot supply or receive the reserve unless it is also the organizer.
- **State:** either path moves `FUNDED` -> `REFUNDED` before transfer.
- **Success:** receipt status `1`, `TournamentRefunded` or `TournamentRecovered`, policy state `REFUNDED`.
- **Failure:** wrong time/state, unauthorized normal refund, wrong chain, wallet rejection, or transfer failure.
- **Evidence:** transaction/event, organizer amount increase, policy state, deadlines, and trigger address.
- **Attestcoin:** no. **Creditcoin:** yes.

### 10. Attempt replay

- **Input:** the same proof payload/source transaction already consumed.
- **Call:** `PrizeRailASC.verifyAndSettle(...)` on CC3.
- **Wallet:** any CC3 wallet with gas.
- **Permissionless:** yes, but expected to revert.
- **Success criterion:** no state change and a rejected transaction. The canonical third run has a mined status-`0` receipt; estimation can reject before a hash exists.
- **UI states:** `REPLAY_REJECTED` only when a receipt or decoded preflight proves rejection; otherwise `UNKNOWN`.
- **Evidence:** replay transaction hash/status/error if mined, consumed mapping/event context, explorer URL.

## Current scripts and CLI

| Command | Actual behavior | Browser/API equivalent |
|---|---|---|
| `npm run api` | Starts the read-only `/api/v1` service. | Implemented locally; hosting remains. |
| `npm run worker` | Starts bounded discovery, proof, settlement, reconciliation, and optional claim. | Implemented locally; live worker evidence remains. |
| `npm run live:preflight` | Reads network IDs, ChainInfo, balances, prover health; requires private-key env values for balance addresses. | Diagnostic alongside `/health`. |
| `npm run live:e2e` | Creates/funds policy, creates/plays/finalizes match, obtains proof, settles, claims, attempts replay; requires `.env` and private keys. | One-shot operational script; durable worker/API orchestration is available locally, while browser wallet writes are limited to the separate organizer create/approve/fund flow. |
| `npm run live:complete -- <tx>` | Resumes from a source tx hash, gets proof, settles/recovers settlement, claims/recovers claim, attempts replay, writes evidence JSON. | Manual recovery tool; browser proof/settlement integration remains deferred. |
| `npm run attestcoin:probe -- <tx>` | Gets/preflights a proof and prints summary; no settlement. | Diagnostic tool; durable proof-job status is exposed by the local worker/API. |
| `npm run verify:demo` | Read-only public-RPC check of a completed evidence JSON bundle. | Historical evidence verifier, not a live status API. |
| `npm run verify:evidence` | Structural assertion over local/live evidence JSON. | Build/submission check, not a user operation. |

## What the frontend may claim now

It may claim that the selected historical runs show a successful Sepolia result, real Attestcoin proof preflight, CC3 semantic settlement, permissionless winner payout, and replay rejection, with the hashes in `research/E2E-RUN-LOG.md`.

It may claim that a local durable worker/read API is implemented and deterministically tested, that the current-code worker-driven
testnet flow is preserved in the fresh v2 timestamped artifact, and that the SPA can display an explicit `LIVE` read when the
loopback API is running. It may claim that EIP-1193 wallet connection, supported-network switching, and the organizer
create/approve/fund transaction path are implemented. It must not claim that the browser write path was live-demonstrated with
MetaMask/OKX, that the service is publicly hosted, that settlement is instant, that arbitrary registries are supported, or
that off-chain fairness/anti-cheat is proven.
