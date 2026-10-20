# Environment Contract

Deployment preparation snapshot: 2026-09-13. The authoritative per-variable inventory, classifications, defaults, sources,
formats, exposure rules, and missing-value behavior are in [docs/PUBLIC-ENVIRONMENT.md](../docs/PUBLIC-ENVIRONMENT.md).
The copyable local template is [.env.example](../.env.example); it contains public defaults and key placeholders only.

## Implemented consumers

| Consumer | Configuration source | Behavior |
|---|---|---|
| Frontend build | Explicit NEXT_PUBLIC_* names in scripts/frontend-build.mjs | esbuild injects a small public object; no bulk environment injection and no .env loading |
| Browser | frontend/src/config.ts build object or checked-in defaults | Wallet uses injected EIP-1193 provider; read API uses NEXT_PUBLIC_API_BASE_URL |
| API and worker | src/worker-runtime.ts, src/deployment.ts, src/api.ts | Process variables take precedence over local .env; selected manifest supplies deployment bindings |
| Render supervisor | scripts/start-render.mjs | Both child processes inherit one environment and PRIZERAIL_DATA_DIR; HOST defaults to 0.0.0.0; provider PORT is consumed by API |
| Local frontend | scripts/frontend-dev.mjs | PRIZERAIL_FRONTEND_PORT defaults to 4173 on loopback |
| Live/deployment scripts | Explicit server RPC and role variables | Missing required keys/URLs fail the operation; these runners are not part of hosted startup |
| Public verifiers | Keyless RPC defaults and optional read-only controls | No private key required, no writes; infrastructure failure remains UNKNOWN |

The frontend deliberately consumes NEXT_PUBLIC_* despite using esbuild rather than Next.js. The complete list is in
PUBLIC-ENVIRONMENT.md; NEXT_PUBLIC_SEPOLIA_RPC_URL and NEXT_PUBLIC_CREDITCOIN_RPC_URL are not consumed.
All public overrides have literal defaults. For public hosting the API base URL must be explicitly replaced with the
Render HTTPS origin ending in /api/v1; absence otherwise directs the visitor to localhost. The build validates API URL
scheme/path and rejects credentials, queries and fragments. Public addresses and rules hashes come from the selected
post-fix manifest with its recorded transaction hashes and block numbers.

## Server persistence and startup

Use one persistent Render Node Web Service with one attached disk, mount /var/data, and
the tested platform runtime NODE_VERSION=22.22.3 (not read by application code). Vercel uses Node 22.x in project settings.
Set PRIZERAIL_DATA_DIR=/var/data/prizerail. The path is configuration, never a business-logic constant. DurableStore creates
directories recursively at mode 0700 and its append-only worker.journal at 0600. It provides interprocess locking and
restart recovery. There is no SQLite, hosted database URL, or session secret in this implementation. Do not split API and
worker into separate services or horizontally scale this file-backed store.

HOST=0.0.0.0 is the Render setting; standalone API defaults to 127.0.0.1. PORT defaults locally to 3000 and must be left for
Render to supply in hosting. /api/v1/live checks API process liveness; /api/v1/health reports dependency readiness, including
UNKNOWN with HTTP 503 during outages. The API binds before network validation.

PRIZERAIL_DEPLOYMENT_MANIFEST defaults to evidence/current-deployment.json. Missing or inconsistent deployment data fails
startup. Chain key and precompile defaults come from the manifest and are validated against runtime ChainInfo/contract
configuration. RPC/prover defaults are keyless; optional credential-bearing overrides are SECRET and server-only.
Missing WORKER_PRIVATE_KEY prevents worker startup. The selected ASC fixes its authorized settlement-worker address, so
the supplied worker key must correspond to that address. WORKER_AUTO_CLAIM defaults false.

CORS_ALLOWED_ORIGINS is a comma-separated exact origin allowlist; absent means no cross-origin grant. Worker tuning defaults
and validation minimums are documented in PUBLIC-ENVIRONMENT.md. The local live worker evidence runner selects a free port
when LIVE_WORKER_API_PORT is absent; .env.example demonstrates an explicit 3011 override.

## Role and verification boundaries

DEPLOYER_PRIVATE_KEY, FINALIZER_PRIVATE_KEY, ORGANIZER_PRIVATE_KEY, PLAYER_ONE_PRIVATE_KEY, PLAYER_TWO_PRIVATE_KEY, and
PAYOUT_TRIGGER_PRIVATE_KEY are LOCAL_ONLY secrets for explicitly authorized live/deployment operations. Only WORKER_PRIVATE_KEY
is needed by the hosted settlement process. ROLE_REUSE_* overrides are explicit local/demo choices; they do not change
immutable contract authorization. Never upload these keys, .env, private logs, proof caches, or journals to Vercel.

VERIFY_DEMO_RPC_TIMEOUT_MS defaults to 8000; VERIFY_DEMO_STOP_ON_FAIL=1 enables early failure exit.
VERIFY_EVIDENCE_RPC_TIMEOUT_MS defaults to 8000; VERIFY_EVIDENCE_SKIP_RPC=1 skips public reads and leaves their status UNKNOWN.
These are LOCAL_ONLY controls. No skipping or timeout override turns uncertainty into successful verification.
The normal default demo verifier continues to read evidence/live-latest.json unchanged.

Browser transaction checks require a real compatible wallet, CC3 gas and PrizeRail test tokens. Local static/browser tests
do not establish wallet or cross-chain settlement success. Hosted public smoke and new blockchain writes remain separately
authorized work.

## Secret policy

Use dedicated minimally funded testnet accounts. Credentials and keyed URLs stay server-side; no public build variable may
contain them. The two public explorer variables are also read by the API/worker for link generation. Keyless public verifier
fallbacks remain available even when the operator uses a keyed server RPC. If adding another provider-specific variable,
document its source, format, exposure and missing behavior in the inventory before use.

Run the publication scan and a general secret scanner on reviewed source and final static output before publishing.
Local data and provider metadata are excluded by .gitignore, which does not retroactively untrack files in a restored Git index.
