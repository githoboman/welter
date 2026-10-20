# Submission Requirements and Evidence Checklist

## Required project information

- [ ] Project name
- [ ] Optional logo URL (`PNG`, `SVG`, or `AI` format listed by organizer)
- [ ] Project sector/track
- [ ] Project description
- [x] Attestcoin integration summary (`IMPLEMENTATION-REPORT.md`)
- [ ] Public GitHub repository URL with README
- [ ] Project deck or whitepaper PDF URL
- [ ] Prototype demo video URL

## Required team information for every member

- [ ] First and last name
- [ ] Email
- [ ] Short bio
- [ ] Team role
- [ ] Country of residence
- [ ] Country of citizenship
- [ ] Optional Telegram ID
- [ ] Optional X/Twitter
- [ ] Optional LinkedIn
- [ ] Optional resume PDF URL

## Mandatory project gates

- [ ] Original work created during the hackathon
- [x] Testnet deployment (current post-fix Sepolia/CC3 set selected by `evidence/current-deployment.json`; three historical complete live runs preserved in `research/E2E-RUN-LOG.md`)
- [x] Working Attestcoin integration code in the project
- [x] Attestcoin is a core feature
- [x] Technical documentation of setup and integration
- [ ] Rights to all submitted code/content/materials
- [ ] No third-party IP infringement
- [x] Accurate and truthful claims, including the explicit source-finalizer/off-chain-cheating limitation

## PrizeRail evidence package (recommended)

### Testnet

- [x] Source `TournamentResultRegistry` address on Sepolia
- [x] Creditcoin `PrizeVault` and `PrizeRailASC` addresses
- [x] Prize funding transactions
- [x] Project-owned `MatchFinalized` source transactions
- [x] Successful Attestcoin settlement transactions with `ResultVerified`
- [x] Winner claim transactions
- [x] Rejected replay transactions with mined status `0`
- [x] Explorer links for all deployed contracts and E2E transactions

### Repository

- [x] Judge fast path requiring no private key (`npm run verify:demo`)
- [x] Exact environment template
- [x] Architecture and threat model
- [x] Attestcoin integration guide
- [x] Test report with commands actually executed
- [x] Deployment metadata JSON
- [x] Evidence document separating live, simulated, mocked, and planned elements
- [ ] License and third-party notices
- [ ] Secret scan

### Demo video

Recommended 2–3 minute sequence:

1. “Tournament winners often wait for or dispute organizer-controlled payouts.”
2. Show funded prize rules on Creditcoin.
3. Finalize the match on Sepolia.
4. Show the proof waiting/proving state.
5. Submit proof; show prize becoming claimable on Creditcoin.
6. Replay the proof; show rejection.
7. Close with explorer evidence and expansion to existing on-chain games.

### Deck

Recommended 8 slides: problem; product; why now; Attestcoin flow; architecture/security; live evidence; market/business model; roadmap/team.

## Deadline control

Official deadline: **2026-09-13 23:59 ET**, equivalent to **2026-09-14 03:59 UTC / 04:59 WAT**. Freeze submission assets at least six hours earlier. Do not rely on last-minute prover, faucet, RPC, video-upload, or DoraHacks availability.

## Sources

- [Official details, rules, and submission fields](https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail)
- [Official timeline](https://dorahacks.io/hackathon/buidl-ctc-2026-fall/buidl)
