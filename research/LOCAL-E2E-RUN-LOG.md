# PrizeRail E2E Run Log

> These are reproducible local Anvil runs using a verifier double installed at the documented `0x0FD2` address. They prove contract/state behavior only. They are not the required live Sepolia-to-CC3 Attestcoin milestone.

Recorded: 2026-09-09T21:54:45.772Z

| Run ID | Source tx | Settlement tx | Payout tx | Replay | Gas (source / settle / payout) |
|---|---|---|---|---|---|
| local-1 | 0x9bd79770311fe86b5f1bddf94d37e41c1d75b69ee46b2c50975eb8917137704f (block 15) | 0xdd90822016c97ba4f590e88d77cd03e6c45be977895fe8b7d49f1aea65530ea3 (block 16) | 0x2352e7a630b9079af171f66e565dcc8e2aa7bcba0bda99107e0ed5b1eb074825 (block 17) | rejected | 90467 / 218431 / 63910 |
| local-2 | 0x9bd79770311fe86b5f1bddf94d37e41c1d75b69ee46b2c50975eb8917137704f (block 15) | 0x704cba64deb0e64a297875951d2ae6c416529e7348e30b8da60eb678ae235886 (block 16) | 0x2352e7a630b9079af171f66e565dcc8e2aa7bcba0bda99107e0ed5b1eb074825 (block 17) | rejected | 90467 / 218431 / 63910 |
| local-3 | 0x9bd79770311fe86b5f1bddf94d37e41c1d75b69ee46b2c50975eb8917137704f (block 15) | 0x97e84bdbcd073163653f8a92f0e39d0a454a11ceea701028991893306324850e (block 16) | 0x2352e7a630b9079af171f66e565dcc8e2aa7bcba0bda99107e0ed5b1eb074825 (block 17) | rejected | 90467 / 218431 / 63910 |

## Negative-path evidence

Each run rejects wrong chain, source registry, event signature, tournament ID, rules hash, winner, nonce, finalization state, invalid proof, unfunded policy, source/business replay, double payout, expired result, and unauthorized settlement/refund. Full machine-readable evidence is overwritten at `evidence/local-e2e-run-1.json` for the last run; rerun the command to reproduce any individual record.
