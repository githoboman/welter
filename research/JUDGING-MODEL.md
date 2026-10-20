# Judging Model

## What is formally verified

The official rules publish only one explicit scoring signal: **depth of Attestcoin Protocol utilization is a core scoring criterion**. No numeric scoring table, weights, panel composition, or tie-break model was published on the inspected official pages.

Therefore, the model below is an internal decision and submission-quality model, not an organizer rubric.

## Evidence-backed judge-value signals

**FACT:** the theme is “BUIDL For The Real World.” Track descriptions repeatedly say practical, transparent, real-world, finance, settlement, coordination, economies, and verified data.

**FACT:** qualifying submissions need a testnet deployment, working integration code, documentation, a public repository/README, a deck or whitepaper, and a prototype video.

**FACT:** the top three are fast-tracked to CEIP due diligence. That creates an explicit post-hackathon company-building signal.

**INFERENCE:** judges are likely to reward a product that is easy to inspect and appears fundable, rather than a technically decorative demo. The strongest evidence package is: a visible source-chain event, a real proof, a Creditcoin state transition, explorer links, replay rejection, and a short verifier command.

## Internal scoring model (100 points)

| Criterion | Weight | What earns full credit |
|---|---:|---|
| Real problem and user clarity | 15 | A named user with an expensive, frequent problem and a believable current workaround |
| Attestcoin necessity and depth | 18 | The core state transition cannot execute without a valid proof; source/status/meaning/replay checks are shown |
| Creditcoin necessity and ecosystem value | 10 | Creditcoin is the policy/settlement/control plane, not a deployment checkbox |
| Working testnet evidence | 14 | Project-owned contracts and transactions on Sepolia and CC3; successful path plus a rejected invalid/replay path |
| Technical correctness and security | 10 | Correct receipt status, source contract, sender/role, selector/event, parameters, finality, replay, and failure handling |
| Demo clarity | 10 | A judge understands the before/after and sees the proof-triggered outcome within two minutes |
| Originality and competitive differentiation | 8 | Not another generic bridge, score, loan, or agent dashboard; clear comparison to live entrants |
| Feasibility and completeness | 7 | Small coherent vertical slice, no critical mocked load-bearing component |
| Product/startup potential | 5 | Repeatable buyer, monetization, and expansion path |
| Documentation and reproducibility | 3 | README fast path, architecture, environment contract, exact addresses, and read-only verification |

## Gating failures

Regardless of score, treat these as submission-threatening:

- Attestcoin is not functionally used.
- The proof result does not control a meaningful state transition.
- Only mocked protocol verification is shown.
- The project is not deployed on testnet.
- The source transaction succeeded but its intended business effect is not validated.
- The same proof can be replayed.
- The repository cannot distinguish project-owned evidence from official examples or fixtures.
- The submission cannot demonstrate original hackathon-period work.

## Recommended judge evidence sequence

1. State the user problem in one sentence.
2. Show a funded/preregistered Creditcoin object.
3. Produce a real result transaction on Sepolia.
4. Show the Attestcoin proof lifecycle and `0x0FD2` verification.
5. Show Creditcoin releasing the prize or changing policy state.
6. Replay the proof and show an expected revert.
7. Give the judge a no-key, read-only verification command and explorer links.

## What aesthetics cannot repair

A polished interface does not compensate for a generic user problem, a mocked proof, or unsafe receipt interpretation. Conversely, a correct protocol demo still needs a visible product outcome. The target is a small, inspectable product—not a protocol science fair and not a landing page.

## Sources

- [Hackathon detail and rules](https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail)
- [Tracks](https://dorahacks.io/hackathon/buidl-ctc-2026-fall/tracks)
- [Creditcoin builder journey and CEIP](https://creditcoin.org/)
