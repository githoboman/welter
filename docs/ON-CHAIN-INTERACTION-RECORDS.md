# BOT Chain On-Chain Interaction Records

**Network**: BOT Chain Testnet (Chain ID `968`)  
**RPC URL**: `https://rpc.bohr.life`  
**Explorer**: [scan.bohr.life](https://scan.bohr.life)  
**Primary Account**: [`0x29108bAb564B53B19C5dde4D00048DB6C41e057C`](https://scan.bohr.life/address/0x29108bAb564B53B19C5dde4D00048DB6C41e057C)  
**Recorded Timestamp**: 2026-10-20T15:38:45.322Z  

---

## Smart Contract Architecture on BOT Chain

| Contract | Address | Explorer Link |
| :--- | :--- | :--- |
| **BotChainSettler** | `0x81f6611d25a7533885dd34bce10600aff0E2E4DE` | [View on Explorer](https://scan.bohr.life/address/0x81f6611d25a7533885dd34bce10600aff0E2E4DE) |
| **PrizeVault** | `0x6edC23FD53d5f861c460397337f505DDF88fCB32` | [View on Explorer](https://scan.bohr.life/address/0x6edC23FD53d5f861c460397337f505DDF88fCB32) |
| **TournamentResultRegistry** | `0x4E64c9a173440e1375460605b7959C3093370d78` | [View on Explorer](https://scan.bohr.life/address/0x4E64c9a173440e1375460605b7959C3093370d78) |
| **MockPrizeToken (PRIZE)** | `0x5A165Cb40fcF5E97ed7f9af37f45a19C1236f664` | [View on Explorer](https://scan.bohr.life/address/0x5A165Cb40fcF5E97ed7f9af37f45a19C1236f664) |

---

## Contract Deployment Transactions

| Contract | Transaction Hash | Block | Status |
| :--- | :--- | :--- | :--- |
| **TournamentResultRegistry** | [`0x54998055a853a126c4c9a7f35a15e313bc50c127d542649ed95777db16907100`](https://scan.bohr.life/tx/0x54998055a853a126c4c9a7f35a15e313bc50c127d542649ed95777db16907100) | 27531122 | Confirmed (Success) |
| **MockPrizeToken (PRIZE)** | [`0x685baaa9a82a343635088a627a59e48b737cb29593e4f4f50a305e9f97526875`](https://scan.bohr.life/tx/0x685baaa9a82a343635088a627a59e48b737cb29593e4f4f50a305e9f97526875) | 27531134 | Confirmed (Success) |
| **PrizeVault** | [`0x63aab24b3a02d8bf62b993753278daf4953fce0aa1df6e58119ddfea7b30b045`](https://scan.bohr.life/tx/0x63aab24b3a02d8bf62b993753278daf4953fce0aa1df6e58119ddfea7b30b045) | 27531139 | Confirmed (Success) |
| **BotChainSettler** | [`0xd14c3d0a7a62ee4491e1f86be26782e27cb7c4a535381d89f75a92406911600d`](https://scan.bohr.life/tx/0xd14c3d0a7a62ee4491e1f86be26782e27cb7c4a535381d89f75a92406911600d) | 27531145 | Confirmed (Success) |

---

## Live End-to-End Tournament Lifecycle Interactions

The following 13 transactions demonstrate a complete, verifiable decentralized tournament lifecycle on BOT Chain: from player onboarding and prize token escrow, through cryptographic move commitments and on-chain outcome derivation, to autonomous settlement and winner payout.

| Step | Action | Transaction Hash | Block | Gas Used | Details |
| :---: | :--- | :--- | :---: | :---: | :--- |
| **1** | **Fund Player Two Gas** | [`0x1b29c003b0ef4dbf...`](https://scan.bohr.life/tx/0x1b29c003b0ef4dbfaeaddf656ffffa11865d1603578662635294aafa98397750) | 27534910 | 21000 | Transferred 0.05 BOT to player 2 (0xe5ec1999C53474cDfD4828F85B1e47e7F0A67F04) for on-chain tournament gameplay interactions. |
| **2** | **Mint PRIZE Tokens** | [`0x1341b35d7e9f9607...`](https://scan.bohr.life/tx/0x1341b35d7e9f9607ac18f25ab3bc73552681171d665c315e2c149c51dfcbd758) | 27534919 | 44163 | Minted 1,000 PRIZE test tokens to tournament organizer (0x29108bAb564B53B19C5dde4D00048DB6C41e057C). |
| **3** | **Approve PrizeVault Allowance** | [`0xe13b583457c15846...`](https://scan.bohr.life/tx/0xe13b583457c1584618367cc7e7dac1e6e17801cfed6f2652855b27f2ef1062e6) | 27534925 | 44136 | Approved PrizeVault (0x6edC23FD53d5f861c460397337f505DDF88fCB32) to pull 100 PRIZE for tournament prize escrow. |
| **4** | **Create Tournament Prize Policy** | [`0x9b931c83eec77fd3...`](https://scan.bohr.life/tx/0x9b931c83eec77fd3c17afb7690f3e42186323731f5301f9c65fc349a0528fbd3) | 27534930 | 169854 | Registered immutable prize policy for tournament 0x1e52c45a7269b9dd... with 100 PRIZE purse. |
| **5** | **Fund PrizeVault Escrow** | [`0xb568eafabbfa7eef...`](https://scan.bohr.life/tx/0xb568eafabbfa7eef86c13cbec73d687162e03b693114cdbedbdd2e13c5b19eae) | 27534935 | 86115 | Funded 100 PRIZE tokens into non-custodial PrizeVault escrow contract. |
| **6** | **Create Match in Registry** | [`0x861799e135015cd6...`](https://scan.bohr.life/tx/0x861799e135015cd67a94fdf64706870d98d4b564c4ddb792dce29c0023000cb5) | 27534941 | 173176 | Initialized match 0x2c5f6e3953941aac... between Player 1 (deployer) and Player 2. |
| **7** | **Player 1 Commit Move** | [`0x4a36cd4896993fec...`](https://scan.bohr.life/tx/0x4a36cd4896993fec9d1af6331a50ee7d566c661af629358adcad8a4b84bd31bf) | 27534946 | 54654 | Player 1 submitted cryptographic move commitment. |
| **8** | **Player 2 Commit Move** | [`0x61601d7a6a5a8abf...`](https://scan.bohr.life/tx/0x61601d7a6a5a8abfb15b99d545e42482a2aed57abe80e9ea1c1429ae457a5555) | 27534952 | 56805 | Player 2 submitted cryptographic move commitment. |
| **9** | **Player 1 Reveal Move** | [`0x2db75073a94e18fe...`](https://scan.bohr.life/tx/0x2db75073a94e18fed0602f18070d631489f373cb0e9bc1b1f11110fc07c5025b) | 27534964 | 58273 | Player 1 revealed move: Rock (Choice 1). |
| **10** | **Player 2 Reveal Move** | [`0x337493486631b7fd...`](https://scan.bohr.life/tx/0x337493486631b7fd841ebc6a50ba0aac58a1a95f48835b675fdcd4f2741652e1) | 27534970 | 43356 | Player 2 revealed move: Scissors (Choice 3). |
| **11** | **Finalize Match Outcome** | [`0xcb02a05a932c3ba6...`](https://scan.bohr.life/tx/0xcb02a05a932c3ba69640d4ab39e04ae3049bfb517a02c8895ebf8ed6927fea4d) | 27534976 | 90467 | Evaluated moves deterministically on-chain: Rock beats Scissors. Player 1 declared winner. |
| **12** | **Settle Prize on BotChainSettler** | [`0x38583e9b31c93ea0...`](https://scan.bohr.life/tx/0x38583e9b31c93ea08158b606128194df5629bf498b8f03acea04d624a69553fb) | 27534982 | 167256 | BotChainSettler verified on-chain result registry and unlocked PrizeVault policy to CLAIMABLE. |
| **13** | **Claim Prize to Winner** | [`0xb8abb1f9ca6d60af...`](https://scan.bohr.life/tx/0xb8abb1f9ca6d60af70be84c4c7a73ea02af892c13fb81fccf696a22894e3d32d) | 27534988 | 46844 | Permissionless claim triggered: 100 PRIZE automatically disbursed from PrizeVault to winner (0x29108bAb564B53B19C5dde4D00048DB6C41e057C). |

---

## Direct Explorer Verification
All transactions can be independently inspected and verified on the official BOT Chain Testnet explorer:
- **Wallet Overview**: https://scan.bohr.life/address/0x29108bAb564B53B19C5dde4D00048DB6C41e057C
- **Tournament Settler Contract**: https://scan.bohr.life/address/0x81f6611d25a7533885dd34bce10600aff0E2E4DE
- **Prize Escrow Vault**: https://scan.bohr.life/address/0x6edC23FD53d5f861c460397337f505DDF88fCB32
