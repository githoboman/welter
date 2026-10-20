# Next Steps

1. Preserve `evidence/live-deployment.json`, the three historical evidence files, the post-fix manifest/run/recovery evidence, and `research/E2E-RUN-LOG.md` as judging artifacts. Keep the retained `evidence/live-28e7fb00.json` labeled as the superseded intermediate artifact described in the run log.
2. Preserve `evidence/worker-live-2026-09-11T22-00-53-430Z.json` as historical pre-hardening evidence; reruns must use new IDs and must not overwrite it. The fresh current-code restart/reconciliation artifact is `evidence/worker-live-v2-2026-09-12T22-53-43-237Z-2056792-055a2cae90a0.json`; see `docs/DURABLE-WORKER-API-CLOSURE-REPORT.md`.
3. Frontend foundation is implemented from `docs/FRONTEND-CONTRACT.md`, `docs/FRONTEND-STATE-MODEL.md`, and `docs/DEMO-FLOW-CONTRACT.md`; keep historical evidence separate from future live asynchronous state.
4. Replace the frontend historical repository boundary with a hosted live API without changing route composition; the local API repository and organizer browser policy flow are implemented, but the hosted URL and extension evidence remain open. See `docs/PUBLIC-DEPLOYMENT.md`.
5. Keep the post-fix contract semantics visible in the UI: both commitments before reveal, permissionless guarded `finalize`, permissionless `claimFor`, organizer refund window, permissionless expired recovery to organizer, and policy-local source registry binding.
6. Complete README/license/submission artifacts, secret scan, deck, and video only after the live worker/API and browser flow are demonstrated truthfully.
7. Obtain independent contract/security review before any real-value token or mainnet deployment.
8. Expand source adapters only with a separate canonical event specification and live evidence per adapter.

The journal schema is still version `1`, but no migration tool exists for pre-hardening records that clear assigned transaction hashes or otherwise fail the current invariants. Preserve such journals read-only; any migration must be separately reviewed and reconstructed from on-chain evidence.
