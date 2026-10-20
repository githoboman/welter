# PrizeRail Implementation Plan

This document is the historical implementation plan. The approved MVP protocol path described here has since been implemented and deployed on Sepolia/CC3; see `IMPLEMENTATION-REPORT.md`, `research/IMPLEMENTED-ARCHITECTURE.md`, and the post-fix manifest selected by `evidence/current-deployment.json` for the authoritative current state. `evidence/live-deployment.json` remains preserved historical provenance. Deferred frontend/API, durable worker, production custody, and mainnet work remains future scope.

## 1. Project foundation

- **Inputs:** final thesis, MVP scope, environment contract, package/version research.
- **Dependencies:** none.
- **Outputs:** repository layout, pinned toolchain, lint/test commands, CI, license, evidence conventions.
- **Definition of done:** clean install/build/test in CI; no secrets; original-work log initialized.
- **Tests:** dependency audit, formatter/linter, empty-suite smoke, secret scan.
- **Evidence:** CI URL/log, lockfile, tool versions, signed/dated project-start note.

## 2. Contract/protocol layer

- **Inputs:** contract spec, state machine, fixed `MatchFinalized` ABI.
- **Dependencies:** milestone 1.
- **Outputs:** source registry, vault, ASC interfaces/stubs only as required for testing, token decision.
- **Definition of done:** all local state transitions and accounting invariants pass without assuming proof correctness.
- **Tests:** unit, fuzz/property, access control, double settlement/claim/refund, deadline boundaries, reentrancy.
- **Evidence:** test report and invariant list mapped to functions.

## 3. Attestcoin integration

- **Inputs:** installed `@gluwa/usc-sdk` version, official examples, CC3 ChainInfo and Block Prover interfaces.
- **Dependencies:** milestones 1–2.
- **Outputs:** verified package/API notes, proof adapter, receipt decoder, ASC proof path.
- **Definition of done:** one real Sepolia transaction verifies on CC3; project event passes; wrong chain/source/event/status/fields and replay fail.
- **Tests:** real-network smoke plus deterministic fixtures for every negative predicate.
- **Evidence:** source and CC3 hashes, decoded fields, explorer links, gas and latency measurements.

## 4. Backend

- **Inputs:** API contract, SDK proof flow, environment variables.
- **Dependencies:** milestone 3 interface stability.
- **Outputs:** status API, job runner, RPC clients, proof submission policy, structured errors.
- **Definition of done:** job resumes by transaction hash and survives restart without duplicate settlement.
- **Tests:** API schema, idempotency, retry/backoff, malformed input, keyed/public RPC configuration, redacted logs.
- **Evidence:** API examples, job trace, retry trace, secret-scan result.

## 5. Indexing/event layer

- **Inputs:** deployed ABI candidates and backend store.
- **Dependencies:** milestones 2 and 4.
- **Outputs:** source/CC3 log scanners, reconciliation job, evidence materializer.
- **Definition of done:** database can be rebuilt for a known tournament from chain events and manifest.
- **Tests:** reorg-safe confirmation behavior, duplicate logs, missed-range recovery, database rebuild.
- **Evidence:** before/after reconstruction checksum and event cursor logs.

## 6. Testnet deployment

- **Inputs:** passing contracts/integration, funded dedicated testnet wallets.
- **Dependencies:** milestones 2–5; current ChainInfo support confirmed.
- **Outputs:** Sepolia registry and CC3 vault/ASC/token deployments, verified sources where supported, manifest.
- **Definition of done:** addresses and compiler settings are reproducible; wallets have minimum required gas; no production-value token is used.
- **Tests:** post-deploy bytecode/config checks and read-only contract calls.
- **Evidence:** deployment JSON, explorer links, tx hashes, deployer balances redacted to public addresses only.

## 7. Frontend foundation

- **Inputs:** public config and deployed ABIs/addresses.
- **Dependencies:** milestone 6 for final configuration; can begin against local interfaces after 2.
- **Outputs:** app shell, wallet/network controls, read client, accessible component baseline.
- **Definition of done:** wrong-chain handling is clear; browser bundle contains no server secrets.
- **Tests:** component, network switching, environment exposure, accessibility smoke.
- **Evidence:** bundle secret scan and screenshots of network/error states.

## 8. Frontend product flows

- **Inputs:** state machine and APIs.
- **Dependencies:** milestones 4, 6, and 7.
- **Outputs:** create/fund, source finalize, proof timeline, claim/refund, evidence pages.
- **Definition of done:** a new user can complete the primary path without reading protocol docs; refresh resumes correctly.
- **Tests:** wallet rejection, slow attestation, failed proof, replay, claim, refund, reload.
- **Evidence:** automated/browser traces and annotated screenshots.

## 9. Integration

- **Inputs:** deployed contracts, worker, indexer, frontend.
- **Dependencies:** milestones 3–8.
- **Outputs:** configured staging system and end-to-end transaction correlation.
- **Definition of done:** one source hash maps to one proof job, one settlement, and one claim with consistent decoded data.
- **Tests:** staging happy path and all contract/API/UI error mappings.
- **Evidence:** correlation/evidence bundle and architecture conformance checklist.

## 10. End-to-end testing

- **Inputs:** staging system.
- **Dependencies:** milestone 9.
- **Outputs:** repeatable E2E suite and at least one preserved historical run.
- **Definition of done:** happy path, wrong source/event/fields, failed receipt fixture, replay, double claim, timeout/recovery, and refund paths are proven.
- **Tests:** automated E2E plus real-network smoke; record observed attestation latency.
- **Evidence:** test report, hashes, timestamps, videos/logs, pass/fail/unknown matrix.

## 11. HCI/UX audit

- **Inputs:** complete product flow and user copy.
- **Dependencies:** milestone 10.
- **Outputs:** issue list and fixes for comprehension, latency, errors, keyboard/accessibility, mobile layout.
- **Definition of done:** five-second product explanation works; proof wait never looks frozen; limitations are visible.
- **Tests:** task walkthrough with a non-builder, keyboard-only run, contrast/labels, small viewport.
- **Evidence:** audit checklist, before/after screenshots, unresolved-issue disclosure.

## 12. Security audit

- **Inputs:** frozen contracts/backend/deployment config and threat model.
- **Dependencies:** milestones 9–11.
- **Outputs:** finding register, remediations, residual-risk statement.
- **Definition of done:** no open critical/high issue; source-authority, worker, replay, accounting, access, secrets, and dependency risks reviewed.
- **Tests:** static analysis, fuzz/invariants, dependency/secret scan, manual adversarial review, replay/concurrency tests.
- **Evidence:** tool outputs, finding disposition, final threat model.

## 13. Demo preparation

- **Inputs:** secure, stable historical and live paths.
- **Dependencies:** milestones 10–12.
- **Outputs:** 2–3 minute script, seeded tournament, backup evidence, no-key verifier, demo recording.
- **Definition of done:** demo shows fund → finalize → prove → settle → claim → replay rejection and states exact trust boundary.
- **Tests:** three timed rehearsals, clean browser/wallet profile, outage fallback drill.
- **Evidence:** final video, script, explorer link sheet, verifier output.

## 14. Submission preparation

- **Inputs:** all evidence, public repository, deck/whitepaper, team data.
- **Dependencies:** milestone 13 and submission checklist.
- **Outputs:** final README, architecture/integration docs, deck PDF, video URL, DoraHacks fields.
- **Definition of done:** every mandatory field and eligibility declaration is complete before September 13, 2026 23:59 ET; links work without team access.
- **Tests:** incognito link audit, fresh-clone judge fast path, claim accuracy review, license/IP review.
- **Evidence:** submission preview/screenshots, final commit hash, archived evidence bundle, timestamped checklist.

## Critical path and build order

The first implementation work should be the protocol spike in milestones 1–3, before frontend work: confirm ChainInfo, prove one known Sepolia transaction, decode one project event, and reject replay. If this fails, product UI work would not repair the submission’s core risk.

The team should explicitly avoid multi-chain adapters, Attestcoin writability, AI adjudication, NFT features, real-value assets, and production claims until the full MVP evidence path passes.
