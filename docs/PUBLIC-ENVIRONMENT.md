# Public deployment environment

This is the deployment-facing environment contract for the current PrizeRail build. The labels are deliberate:

- `FRONTEND_PUBLIC`: injected into the browser bundle; treat it as public and never put credentials in its value.
- `RENDER_SERVER`: configured only on the one persistent Render Web Service running `npm run start:render`.
- `LOCAL_ONLY`: used by local development, deployment scripts, or live evidence runners; do not configure it on Vercel.
- `OPTIONAL`: a safe default exists or the feature is intentionally disabled when absent.
- `SECRET`: credential material; never commit or expose it to the browser.

The frontend build consumes the actual `NEXT_PUBLIC_*` names below. It does not consume browser RPC variables; wallet reads and
writes use an injected EIP-1193 provider, while public API reads use `NEXT_PUBLIC_API_BASE_URL`.

| Variable | Classification | Used by | Required/default and format |
|---|---|---|---|
| `NODE_VERSION` | `RENDER_SERVER` · `OPTIONAL` | Render platform runtime selection | set `22.22.3`; if absent Render selects its service-date-dependent default; not read by application code |
| `NEXT_PUBLIC_SEPOLIA_CHAIN_ID` | `FRONTEND_PUBLIC` | Vercel build / browser wallet guard | `11155111`; positive integer |
| `NEXT_PUBLIC_CREDITCOIN_CHAIN_ID` | `FRONTEND_PUBLIC` | Vercel build / browser wallet guard | `102031`; positive integer |
| `NEXT_PUBLIC_ATTESTCOIN_CHAIN_KEY` | `FRONTEND_PUBLIC` | Vercel build / organizer policy binding | `1`; positive integer |
| `NEXT_PUBLIC_SEPOLIA_EXPLORER_URL` | `FRONTEND_PUBLIC` | Vercel build / evidence links | HTTPS explorer base, no credentials |
| `NEXT_PUBLIC_CREDITCOIN_EXPLORER_URL` | `FRONTEND_PUBLIC` | Vercel build / evidence links | HTTPS explorer base, no credentials |
| `NEXT_PUBLIC_API_BASE_URL` | `FRONTEND_PUBLIC` · `OPTIONAL` | Vercel build / browser API reads | Hosted `https://<render-host>/api/v1`; local fallback is `http://localhost:3000/api/v1` |
| `NEXT_PUBLIC_CURRENT_WORKER_TOURNAMENT_ID` | `FRONTEND_PUBLIC` · `OPTIONAL` | Vercel build / example lookup | `0x` plus 64 hex characters |
| `NEXT_PUBLIC_RESULT_REGISTRY_ADDRESS` | `FRONTEND_PUBLIC` | Vercel build / source binding | `0x` plus 40 hex characters |
| `NEXT_PUBLIC_RESULT_RULES_HASH` | `FRONTEND_PUBLIC` | Vercel build / policy binding | `0x` plus 64 hex characters |
| `NEXT_PUBLIC_SOURCE_FINALIZER_ADDRESS` | `FRONTEND_PUBLIC` | Vercel build / display only | `0x` plus 40 hex characters |
| `NEXT_PUBLIC_PRIZE_VAULT_ADDRESS` | `FRONTEND_PUBLIC` | Vercel build / browser organizer flow | `0x` plus 40 hex characters |
| `NEXT_PUBLIC_PRIZERAIL_ASC_ADDRESS` | `FRONTEND_PUBLIC` | Vercel build / display only | `0x` plus 40 hex characters |
| `NEXT_PUBLIC_PRIZE_TOKEN_ADDRESS` | `FRONTEND_PUBLIC` | Vercel build / browser organizer flow | `0x` plus 40 hex characters |
| `SEPOLIA_RPC_URL` | `RENDER_SERVER` · `OPTIONAL` | API/worker and read-only verifier override | HTTPS/WSS RPC; keyless Sepolia default exists |
| `CREDITCOIN_RPC_URL` | `RENDER_SERVER` · `OPTIONAL` | API/worker and read-only verifier override | HTTPS/WSS CC3 RPC; keyless CC3 default exists |
| `ATTESTCOIN_SOURCE_CHAIN_KEY` | `RENDER_SERVER` | worker runtime validation | `1`; must match ChainInfo and manifest |
| `ATTESTCOIN_PROVER_URL` | `RENDER_SERVER` · `OPTIONAL` | worker proof acquisition and health | HTTPS prover URL; jobs remain `UNKNOWN` if unavailable |
| `ATTESTCOIN_BLOCK_PROVER_ADDRESS` | `RENDER_SERVER` | worker runtime validation | expected `0x…fd2` precompile address |
| `ATTESTCOIN_CHAIN_INFO_ADDRESS` | `RENDER_SERVER` | worker runtime validation | expected `0x…fd3` precompile address |
| `PRIZERAIL_DEPLOYMENT_MANIFEST` | `RENDER_SERVER` · `OPTIONAL` | API/worker/live scripts | `evidence/current-deployment.json` |
| `CORS_ALLOWED_ORIGINS` | `RENDER_SERVER` · `OPTIONAL` | API | comma-separated exact HTTPS Vercel origin(s); no wildcard |
| `PORT` | `RENDER_SERVER` · `OPTIONAL` | API listener | Render supplies it; local default `3000`; do not hard-code production port |
| `HOST` | `RENDER_SERVER` · `OPTIONAL` | API listener | Render `0.0.0.0`; local default `127.0.0.1` |
| `PRIZERAIL_DATA_DIR` | `RENDER_SERVER` | API/worker durable store | Render `/var/data/prizerail`; local default `.data/prizerail` |
| `WORKER_CONFIRMATIONS` | `RENDER_SERVER` · `OPTIONAL` | worker | default `1`; nonnegative integer |
| `WORKER_SOURCE_START_BLOCK` | `RENDER_SERVER` · `OPTIONAL` | worker | at/after manifest deployment block; blank uses manifest block |
| `WORKER_BATCH_SIZE` | `RENDER_SERVER` · `OPTIONAL` | worker | default `100`; positive integer |
| `WORKER_POLL_INTERVAL_MS` | `RENDER_SERVER` · `OPTIONAL` | worker | default `15000`; at least `100` |
| `WORKER_MAX_ATTEMPTS` | `RENDER_SERVER` · `OPTIONAL` | worker | default `12`; positive integer |
| `WORKER_LEASE_TTL_MS` | `RENDER_SERVER` · `OPTIONAL` | worker | default `60000`; at least `1000` ms |
| `WORKER_REORG_REWIND` | `RENDER_SERVER` · `OPTIONAL` | worker | default `6`; nonnegative integer |
| `WORKER_AUTO_CLAIM` | `RENDER_SERVER` · `OPTIONAL` | worker | default `false`; recommended Render value `false` |
| `DEPLOYER_PRIVATE_KEY` | `LOCAL_ONLY` · `SECRET` | deployment scripts | dedicated testnet-only 32-byte key; never Render/Vercel |
| `FINALIZER_PRIVATE_KEY` | `LOCAL_ONLY` · `SECRET` | live source-result scripts | dedicated Sepolia testnet-only key; never Render/Vercel |
| `ORGANIZER_PRIVATE_KEY` | `LOCAL_ONLY` · `SECRET` | live policy scripts | dedicated CC3 testnet-only key; never Render/Vercel |
| `PLAYER_ONE_PRIVATE_KEY` | `LOCAL_ONLY` · `SECRET` | live source scripts | dedicated Sepolia testnet-only key; never Render/Vercel |
| `PLAYER_TWO_PRIVATE_KEY` | `LOCAL_ONLY` · `SECRET` | live source scripts | dedicated Sepolia testnet-only key; never Render/Vercel |
| `WORKER_PRIVATE_KEY` | `RENDER_SERVER` · `SECRET` | settlement worker | dedicated minimum-balance CC3 testnet-only key; never browser |
| `PAYOUT_TRIGGER_PRIVATE_KEY` | `LOCAL_ONLY` · `SECRET` | live recovery/claim scripts | dedicated CC3 testnet-only key; never Render/Vercel |
| `ROLE_REUSE_FINALIZER` | `LOCAL_ONLY` · `OPTIONAL` | local/live scripts | explicit existing role name; no implicit reuse |
| `ROLE_REUSE_ORGANIZER` | `LOCAL_ONLY` · `OPTIONAL` | local/live scripts | explicit existing role name; no implicit reuse |
| `ROLE_REUSE_PLAYER_ONE` | `LOCAL_ONLY` · `OPTIONAL` | local/live scripts | explicit existing role name; no implicit reuse |
| `ROLE_REUSE_PLAYER_TWO` | `LOCAL_ONLY` · `OPTIONAL` | local/live scripts | explicit existing role name; no implicit reuse |
| `ROLE_REUSE_PAYOUT_TRIGGER` | `LOCAL_ONLY` · `OPTIONAL` | local/live scripts | explicit existing role name; no implicit reuse |
| `LIVE_WORKER_API_PORT` | `LOCAL_ONLY` · `OPTIONAL` | live worker evidence runner | absent selects a free loopback port; example `3011` |
| `PRIZERAIL_FRONTEND_PORT` | `LOCAL_ONLY` · `OPTIONAL` | static development listener | default `4173`; TCP port |
| `VERIFY_DEMO_RPC_TIMEOUT_MS` | `LOCAL_ONLY` · `OPTIONAL` | read-only demo verifier | default `8000`; milliseconds |
| `VERIFY_DEMO_STOP_ON_FAIL` | `LOCAL_ONLY` · `OPTIONAL` | read-only demo verifier | `1` stops after first FAIL; absent/`0` checks all |
| `VERIFY_EVIDENCE_RPC_TIMEOUT_MS` | `LOCAL_ONLY` · `OPTIONAL` | read-only worker evidence verifier | default `8000`; milliseconds |
| `VERIFY_EVIDENCE_SKIP_RPC` | `LOCAL_ONLY` · `OPTIONAL` | read-only worker evidence verifier | `1` skips public reads and leaves them UNKNOWN; absent/`0` performs reads |
| `ROLE_REUSE_WORKER` | `LOCAL_ONLY` · `OPTIONAL` | explicit local role resolver | existing role name; absent requires dedicated worker key |
| `ROLE_REUSE_DEPLOYER` | `LOCAL_ONLY` · `OPTIONAL` | explicit local role resolver | existing role name; deployment scripts still require DEPLOYER_PRIVATE_KEY directly |

## Sources and missing-value behavior

The source of public addresses, rules hash, network IDs and precompiles is the selected versioned
`evidence/current-deployment.json` manifest and its transaction/block evidence. Explorer and keyless network defaults are
literal defaults in `scripts/frontend-build.mjs` and `src/worker-runtime.ts`. Operator choices supply ports, origins, storage
paths and tuning. Wallet owners supply role secrets. Verifier controls come from the local operator, never a hosting platform.

Every browser variable is optional at the implementation level: missing/blank values use the explicit defaults in
`scripts/frontend-build.mjs` and `frontend/src/config.ts`, including current post-fix addresses and the example tournament.
For a hosted build, `NEXT_PUBLIC_API_BASE_URL` is operationally required: its fallback points to the visitor's localhost.
Invalid chain numbers or invalid API URLs fail the build. The frontend build does not load `.env`; pass values through the
build environment. It injects an explicit object, never `process.env` or a prefix-wide environment dump.

API/worker load local `.env` only for unset values. In Render configure variables directly and upload no `.env` file.
Missing RPC/prover values use the keyless defaults below; unavailable dependencies report UNKNOWN. Missing chain key and
precompile addresses use the manifest and still undergo runtime validation. Missing/invalid manifest or mismatched
configuration fails closed. Missing WORKER_PRIVATE_KEY prevents the worker from starting (the read API can run without it).
Other role keys are required only by the corresponding local live/deployment runner; absent keys fail that operation unless
explicit supported role reuse is configured. The Render worker key must match the selected ASC settlement-worker address;
a different dedicated key cannot authorize settlement against that immutable deployment.

Worker tuning uses the defaults in the table; invalid values fail configuration. Data directory defaults locally to
`.data/prizerail`; Render must override it to the persistent mount. The runtime creates the directory recursively (0700)
and journal (0600); it never copies local journal data into static output. CORS defaults to no cross-origin grant.
The supervisor defaults HOST to 0.0.0.0; standalone API defaults to 127.0.0.1. Both use the provider PORT or local 3000.

RPC/prover URLs become SECRET if they contain credentials (including tokens embedded in paths); keep even keyless overrides
on Render only. The two NEXT_PUBLIC explorer variables are also read by the API/worker for public links and may be set on
Render if their default is overridden. No database URL or session-secret variable is consumed by this implementation.
LOCAL_ONLY means not needed by the hosted runtime; RENDER_SERVER variables also work in local development.

## Exact Render values

Set these on the single Render Web Service:

```text
NODE_VERSION=22.22.3
HOST=0.0.0.0
PRIZERAIL_DATA_DIR=/var/data/prizerail
PRIZERAIL_DEPLOYMENT_MANIFEST=evidence/current-deployment.json
CORS_ALLOWED_ORIGINS=https://<vercel-project>.vercel.app
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
CREDITCOIN_RPC_URL=https://rpc.cc3-testnet.creditcoin.network
ATTESTCOIN_SOURCE_CHAIN_KEY=1
ATTESTCOIN_PROVER_URL=https://prover.cc3-testnet.creditcoin.network
ATTESTCOIN_BLOCK_PROVER_ADDRESS=0x0000000000000000000000000000000000000fd2
ATTESTCOIN_CHAIN_INFO_ADDRESS=0x0000000000000000000000000000000000000fd3
WORKER_AUTO_CLAIM=false
```

Add `WORKER_PRIVATE_KEY` as a Render secret. Leave `PORT` unset so the provider supplies it. Add the worker tuning variables
only when the default is intentionally changed.

## Exact Vercel values

Set only the `FRONTEND_PUBLIC` values. At minimum:

```text
NEXT_PUBLIC_API_BASE_URL=https://<render-service>.onrender.com/api/v1
NEXT_PUBLIC_SEPOLIA_CHAIN_ID=11155111
NEXT_PUBLIC_CREDITCOIN_CHAIN_ID=102031
NEXT_PUBLIC_ATTESTCOIN_CHAIN_KEY=1
NEXT_PUBLIC_SEPOLIA_EXPLORER_URL=https://sepolia.etherscan.io
NEXT_PUBLIC_CREDITCOIN_EXPLORER_URL=https://creditcoin-testnet.blockscout.com
```

Set the remaining public values explicitly from the selected post-fix manifest:

```text
NEXT_PUBLIC_RESULT_REGISTRY_ADDRESS=0xDdDA859AC766E3eaE59Dc7b7B85465610aF90a3f
NEXT_PUBLIC_RESULT_RULES_HASH=0x7564123213f3cffdfa6237a0067717f6f1a13dc65a0b69e6960cbe5ca8c94331
NEXT_PUBLIC_SOURCE_FINALIZER_ADDRESS=0x0d6FAee78dFF4380E77D0e412F5Cddd942673719
NEXT_PUBLIC_PRIZE_TOKEN_ADDRESS=0x9366e8298799A132D20F51021d6Ef3A99D57817C
NEXT_PUBLIC_PRIZE_VAULT_ADDRESS=0x270B97d063668d9B2107d15E08a81Af2318E7edC
NEXT_PUBLIC_PRIZERAIL_ASC_ADDRESS=0xD5226c2eC2C6958A9785C29DADBc28810f718CCf
NEXT_PUBLIC_CURRENT_WORKER_TOURNAMENT_ID=0x38068ece64fe32ff70d3de7445ec16350ff2f661e13dffbdccd91bbe96f2ae47
```

These are public deployment facts, not evidence of a new deployment. Their transaction hashes and blocks remain in
`evidence/post-fix-deployment-2026-09-10T02-43-34-178Z.json`.
 Never configure any `SECRET`, worker,
RPC, prover, journal, or local-only variable on Vercel.
