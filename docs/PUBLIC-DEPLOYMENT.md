# Public deployment boundary

Status: prepared, not deployed. No public PrizeRail frontend or API URL is claimed by this repository.

## Render API and worker service

Use exactly one Render **Web Service** for the API and asynchronous worker. Do not create separate API and worker services: the
append-only file journal is intentionally shared by both processes, while Render persistent disks are accessible to only one
service instance.

Recommended settings:

| Setting | Value |
|---|---|
| Service type | Web Service |
| Runtime | Native Node.js; Docker is not required |
| Node version | `NODE_VERSION=22.22.3` (locally tested) |
| Root directory | Leave blank (repository root) |
| Compute plan | Paid `1c-2g` (the current Standard-equivalent plan; one instance) |
| Build command | `npm ci --include=dev && npm run compile:direct` |
| Start command | `npm run start:render` |
| Health check path | `/api/v1/live` (API process liveness only) |
| Instance count | `1`; do not scale horizontally with the disk attached |
| Disk | `1 GB` persistent disk mounted at `/var/data` |
| Data directory | `PRIZERAIL_DATA_DIR=/var/data/prizerail` |
| Public bind | `HOST=0.0.0.0`; the service consumes Render's `PORT` |

FACT, checked 2026-09-13: Render's [compute plan documentation](https://render.com/docs/compute-plans) lists `1c-2g` as the
1 CPU / 2 GB Standard-equivalent plan. Its [disk documentation](https://render.com/docs/disks) requires a paid service. It
also limits a disk to one service instance, which is why this design has one service instance and one supervisor process. The
actual Render dashboard selection has not been made in this repository; verify the selected plan and attached disk in the
service settings immediately before deployment.

Pin the tested runtime using Render's documented [NODE_VERSION setting](https://render.com/docs/node-version).

The supervisor starts the same Node entry points as `npm run api` and `npm run worker`, prefixes their logs as `[api]` and `[worker]`, forwards termination
signals, shuts down both children, and exits nonzero if either critical child exits unexpectedly.

`/api/v1/live` explicitly reports only `API_PROCESS_ONLY`. `/api/v1/health` retains dependency readiness and can return HTTP 503
with `UNKNOWN` during RPC/prover outages. It is bound before network validation and probes external health concurrently with
a ten-second per-probe bound. Do not interpret liveness as successful protocol operation. A child shutdown exceeding ten
seconds is force-terminated and the supervisor exits nonzero. Disk-backed services have deployment downtime; the disk is
available only at runtime, not during the build. Choosing 2 GB is an operational starting recommendation, not a load-test claim.

Required Render server environment variables are listed in [`PUBLIC-ENVIRONMENT.md`](PUBLIC-ENVIRONMENT.md). In particular,
set the public frontend origin in `CORS_ALLOWED_ORIGINS`, keep all RPC/prover URLs and `WORKER_PRIVATE_KEY` server-side, and
leave `PORT` unset so Render supplies it. `WORKER_AUTO_CLAIM=false` is the recommended default; the worker then makes a
funded policy `CLAIMABLE` and does not automatically trigger the permissionless claim.

The persistent disk stores only runtime journal data. It must not be used as a substitute for the checked-in public evidence
bundle, and it must not be copied into a frontend build.

## Vercel frontend

Root `vercel.json` configures the static SPA:

| Setting | Value |
|---|---|
| Root directory | Leave blank (repository root) |
| Build command | `npm run frontend:build` |
| Install command | `npm ci --include=dev` |
| Output directory | `frontend/public` |
| Framework | Other / static output (no serverless functions) |
| Node.js build version | `22.x` in project Build and Deployment settings |
| SPA rewrites | `/app` and `/app/:path*` → `/index.html` |
| Evidence URLs | `/evidence/live-2026-09-10T02-44-30-530Z.json`, `/evidence/recovery-f620cf7d.json`, `/evidence/post-fix-deployment-2026-09-10T02-43-34-178Z.json` |

The build copies exactly those three reviewed files into `frontend/public/evidence/` and fails if any is absent, invalid, or fails the
browser-safety scan. It does not copy the repository's full `evidence/` directory. The build output is generated and ignored by
Git.

The complete static allowlist is `index.html`, `styles.css`, `dist/app.js`, `dist/app.js.map`, and those three JSON files.
Unexpected files in that output directory fail the build; source/tests and old output directories are not deployed.
Local `npm run frontend:dev` serves the same output and returns 404 for missing evidence.
Vercel supports selecting the Node major version in its [project settings](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

Set only the `NEXT_PUBLIC_*` values listed as `FRONTEND_PUBLIC` in [`PUBLIC-ENVIRONMENT.md`](PUBLIC-ENVIRONMENT.md), including:

```text
NEXT_PUBLIC_API_BASE_URL=https://<render-service>.onrender.com/api/v1
NEXT_PUBLIC_SEPOLIA_CHAIN_ID=11155111
NEXT_PUBLIC_CREDITCOIN_CHAIN_ID=102031
NEXT_PUBLIC_ATTESTCOIN_CHAIN_KEY=1
NEXT_PUBLIC_SEPOLIA_EXPLORER_URL=https://sepolia.etherscan.io
NEXT_PUBLIC_CREDITCOIN_EXPLORER_URL=https://creditcoin-testnet.blockscout.com
```

Also set the selected post-fix registry, rules hash, finalizer, token, vault, ASC, and optional current worker tournament ID
from `.env.example`. These values are public configuration. Do not set any server-only key, keyed RPC URL, prover credential,
database URL, or worker variable in Vercel. No `NEXT_PUBLIC_*_RPC_URL` variable is used by the current browser bundle.

## Release gate

Do not publish a live URL until all of these are independently checked:

1. The frontend build succeeds, contains the three allowlisted evidence files, and contains no server-only values.
2. The Render service binds the provider `PORT` on `0.0.0.0`, and `/api/v1/health` is externally reachable.
3. The API health response reports real persistence, worker, RPC, ChainInfo, and proof-service outcomes; infrastructure
   uncertainty remains `UNKNOWN`.
4. A fresh browser lookup reads the worker journal over the public API and keeps historical evidence labeled separately.
5. A public frontend/API/source-result-to-settlement run is evidenced with hashes, blocks, policy state, payout, and replay.

The default `npm run verify:demo` behavior is a separate submission-hardening item: it reads `evidence/live-latest.json` and may
return overall `UNKNOWN`. This preparation does not weaken, rewrite, or reinterpret that verifier result.

Until these checks pass, deployment status is `UNKNOWN`/`NOT_DEPLOYED`, not `PASS`.
