# PrizeRail E2E Run Log

This log separates load-bearing live evidence from local verifier-double runs. Live runs use Ethereum Sepolia as the source, the hosted Attestcoin prover plus CC3 native block prover as the proof path, and Creditcoin CC3 as the settlement/claim chain. The earlier rows remain historical one-shot runs. The preserved worker artifact predates the stricter journal invariant; current-code restart/reconciliation closure is recorded by the fresh v2 artifact in the durable worker/API section below.

## Complete live runs

All three runs use the selected deployment set in [`evidence/live-deployment.json`](../evidence/live-deployment.json). Each run records a successful `MatchFinalized` receipt, a real Attestcoin proof accepted by the CC3 precompile, an atomic vault settlement, a winner claim, and a replay rejection.

| Run | Finalized UTC | Source tx (block/gas) | Attestcoin proof (header/latency) | Settlement tx (block/gas) | Payout tx (block/gas) | Replay tx (status/gas) | Final |
|---|---|---|---|---|---|---|---|
| `live-0e71e430` | `2026-09-09T18:54:12Z` | `0xe6eb3630c679e660e90c507e98cb52587fed08d7290039f0cc29124b1565afbd` (11669825 / 90467) | `0x149a410c18bce57fbf221ef888a5f2435fb16dddf69c458c5ded248f5fa9fdee` (11669825 / 12.640 s) | `0x96b228a37da4a40d390f8b2d48933c8ae7090df00491554ac5cad819e4acecfb` (5459325 / 238375) | `0xc1b90f2647e59cd5c594015d7725a41efd0fbf5d4ca5bfaa4b488fa7b500d921` (5459363 / 78554) | `0x23a3d146a486b4a261f2b93d2036e63a3af361eb61d3aeb1cec0beb233ac27a6` (`0` / 143822) | PASS |
| `live-8a2fbafc` | `2026-09-09T18:56:00Z` | `0x70f6b6c25dde720dc44db434180836121b088978216ea7bf3b421776134d31a6` (11669834 / 90467) | `0x33e0c5796fe8c5f90a5bee566c5abc76bdd0c234973682c789b8d7cfd49c33ad` (11669834 / 19.958 s) | `0x44a9dfa92bf3376dc539b18e44461f73fd8653ce3aa9d1f3c3d2b8f99b145e19` (5459375 / 239444) | `0xb6647b056d8374e90323c29043be4215394aba9ff290e1fdbacf2a12dc62c890` (5459376 / 78554) | `0xa1eaadb22f68b880ec1ee635d74d3a964810a44a0865389ce810c5327dfcee25` (`0` / 144270) | PASS |
| `live-ab26885f` | `2026-09-09T20:00:00Z` | `0x7f2de354984d134aa7c46f87fc7149839e8c2b5d17c048cb688333e1548bd0af` (11670146 / 90467) | `0x719e7c8936fa56a4c1df8e4e2f8d5502fd6b0a47a51fdfdd7f85e5cd74799249` (11670146 / 539.919 s) | `0x4dfb73eaa0108563a5e0174de10a3aa60a8057f5c8dec5e4d83ad5e780260e01` (5459591 / 237594) | `0x31c728d0961cc6697f037364c8014966a7222328e451f8ab7fda7907ef969c34` (5459592 / 78554) | `0x4e9d46cc9216ea7735f3c7fdd920b45a47e3a3c1c2aefc46d3f8bba745b3ad7e` (`0` / 143374) | PASS |

Evidence files are [`evidence/live-0e71e430.json`](../evidence/live-0e71e430.json), [`evidence/live-8a2fbafc.json`](../evidence/live-8a2fbafc.json), and [`evidence/live-2026-09-09T19-57-48-089Z.json`](../evidence/live-2026-09-09T19-57-48-089Z.json). `evidence/live-latest.json` points to the third run. The no-key verifier checks the latest bundle against public RPC state:

```bash
npm run verify:demo
```

The third run's verifier result is `overall: PASS`, including source event binding, real proof verification, settlement/payout receipts, `CLAIMED` state, winner balance `4 PRIZE`, and mined replay status `0`.

Current verifier audit note: rerunning `verify:demo` against these preserved bundles still validates their receipts, events, bindings, payout, and replay evidence, but reports `UNKNOWN` overall because the historical JSON omits `destination.amount`; the verifier does not infer that missing recorded field. The historical JSON and rows above remain unchanged.

## Post-fix deployment and run

The historical three-run section above is unchanged. Contract hardening required new bytecode and a new versioned deployment recorded in [`evidence/post-fix-deployment-2026-09-10T02-43-34-178Z.json`](../evidence/post-fix-deployment-2026-09-10T02-43-34-178Z.json), selected by [`evidence/current-deployment.json`](../evidence/current-deployment.json).

Post-fix run `live-f99b1968` is recorded in [`evidence/live-2026-09-10T02-44-30-530Z.json`](../evidence/live-2026-09-10T02-44-30-530Z.json):

- source registry `0xDdDA859AC766E3eaE59Dc7b7B85465610aF90a3f`;
- source transaction `0x9629ae21376cfad615c49c65b2fab76a7522ca4170da0d6edcbf25369bff42a6`, block `11672111`;
- recorded proof digest `0x189b874912e7d21ae0e166e0a17480f23af57ce2909ffec5cef0a0eaf86ca596`, native preflight `true`, observed latency `576.982s`;
- settlement `0x30b549ed395700eefbb69ea924b767c15639d12378ff000c69cf1c66ca0a9119`, payout `0xf0b5dda8f92005386313576a3ff58628baf856888b4f7e62f4b60474021818a3`, replay rejection `0x02b5d771147076537c9d985ff2c2f225988976ab12c7cab61f08872abe0b5d7b` status `0`;
- both commitments preceded both reveals in the recorded source step sequence;
- roles were configured separately but explicitly reused the two available funded wallets, so separated live custody is not claimed.

Targeted expired-policy recovery is recorded in [`evidence/recovery-f620cf7d.json`](../evidence/recovery-f620cf7d.json): third-party trigger `0x96d6…2082`, immutable organizer `0x0d6F…3719`, recovery transaction `0x06e79fe69ab8e68c2ec30cf93d89454c3ec7d7a211366161604d9ceab99a9c7d`, terminal state `REFUNDED`, organizer balance increase `1 PRIZE`, and settlement blocked by the state guard.

## Durable worker/API run

Preserved worker run `worker-live-28e7fb00` is recorded in [`evidence/worker-live-2026-09-11T22-00-53-430Z.json`](../evidence/worker-live-2026-09-11T22-00-53-430Z.json). The public read verifier validates its live receipts and bindings, while the stricter evidence-closure verifier intentionally rejects this legacy v1 shape. It remains historical and read-only.

- source `MatchFinalized`: `0x1ff6354200b553b10a8b7714a7837bd0ab8791a200d4c734369e998b643e36a6`, block `11679976`, status `1`;
- Attestcoin proof digest: `0x4d3245c17b37fdc1f3bd8cf96e9639de5f80a974d01c6e42703c143696c9abd9`, header `11679976`, native preflight `true`, cached retrieval latency `20.298s`;
- settlement: `0x6f71453dfe83b01e7b93317bdbc570b5ee6792693579891b0fd69e67b7964e59`, block `5467691`, status `1`;
- payout: `0x00c3c3141f28f495ba2f51765d37aed5b53873957a14874e6c1c8dc75bda042c`, block `5467694`, status `1`, `PrizeClaimed` present;
- replay rejection: `0x834c3e786fa5448e79d4ab4bedcb535d341f509b41d7e27af1bfb9f69eb9ab08`, block `5471266`, status `0`;
- durable job `job-1b91454710bce0703caea266` records restart from `AWAITING_ATTESTATION` (`proofAttempts=[1,2]`, three runtime IDs), one settlement hash, and one payout hash;
- final API envelope is `LIVE`/`PASS`/`CLAIMED`; raw proof bytes are not persisted or returned.

The retained `evidence/live-28e7fb00.json` is a superseded intermediate artifact from the same post-fix job, before the worker evidence materializer obtained the mined replay receipt. It has no replay transaction hash and is not counted as a complete run; use the worker artifact above for the preserved historical result. Do not present the intermediate file as standalone success. The corresponding historical journal cannot be reopened by current code because a pre-hardening retry snapshot clears an assigned settlement hash; it must remain read-only.

### Current-code closure run

The fresh post-hardening v2 run is recorded in [`evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json`](../evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json) and summarized in [`docs/DURABLE-WORKER-API-CLOSURE-REPORT.md`](../docs/DURABLE-WORKER-API-CLOSURE-REPORT.md). It uses source transaction `0x87f178ef3644f18d819f7e7eb6d34321c74aa109376b2542b170abed1a5419fc` at Sepolia block `11691988`, durable job `job-e997b3df3ae9ed4baddf1c49`, proof header `11691988` with native preflight `true`, settlement `0xf0c9d534755b13c48aca8d916795e2db7b8f201b040c9737019d3f28c1d85c65` at CC3 block `5477570`, payout `0x6e509ddf7307b49f829e13602ea6a70b74715b783c77796efd7f7a6100799bf9` at CC3 block `5477573`, and replay rejection `0xd068be401c14935d4e80b464471fc1bc82f3bdb4d9ab3244e3e85cf904822f91` with status `0`. The artifact records restart during attestation, immutable single settlement/payout identities, and a final API projection of `LIVE`/`PASS`/`CLAIMED`.

## Failures and latency observations

- Run 1: settlement evidence was recovered from the on-chain `ResultVerified` event during evidence materialization; the settlement, claim, and replay receipts all validate.
- Run 2: no semantic or transaction failure was observed; proof retrieval took 19.958 seconds.
- Run 3: Attestcoin attestation waited 539.919 seconds. The first replay attempt did not yield a receipt through estimation; resubmitting with an explicit gas limit produced the recorded status-`0` transaction.
- The observed source-to-settlement times were 513 seconds, 1155 seconds, and 555 seconds respectively. These are observations, not service-level guarantees.

## Partial attempt not counted

An earlier `npm run live:e2e` attempt funded a third CC3 tournament (`0x8c7ff158e66e3bf5ec92bb7320abb8543ffb9898e20747cbca5418eb1865e01`) and advanced the deployer nonces, but no recoverable `MatchFinalized` event or completed settlement was found. It is intentionally excluded from the three-run count and is not presented as success.

## Local contract evidence

Local Anvil runs use a verifier double at the documented `0x0FD2` address. They prove contract and accounting behavior only; they are not Attestcoin evidence. The recorded local negative-path suite covers wrong chain/source/event/tournament/rules/winner/nonce, failed receipt, invalid finalization/proof, expiry, unfunded and unauthorized actions, source/business replay, and double payout. `npm run local:e2e:three` writes its output to [`research/LOCAL-E2E-RUN-LOG.md`](LOCAL-E2E-RUN-LOG.md) and cannot overwrite this live log.
