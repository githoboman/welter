import { promises as fs } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();

// Only these files have been reviewed as public, judge-facing evidence. Keep
// the list explicit: other evidence includes historical embedded journal
// snapshots that the UI does not need.
const CURATED_PUBLIC_EVIDENCE = [
  'live-2026-09-10T02-44-30-530Z.json',
  'recovery-f620cf7d.json',
  'post-fix-deployment-2026-09-10T02-43-34-178Z.json',
  'botchain-deployment-2026-10-20T14-50-43-758Z.json',
];

const SECRET_MARKERS = [
  /WORKER_PRIVATE_KEY|DEPLOYER_PRIVATE_KEY|FINALIZER_PRIVATE_KEY|ORGANIZER_PRIVATE_KEY|PLAYER_ONE_PRIVATE_KEY|PLAYER_TWO_PRIVATE_KEY|PAYOUT_TRIGGER_PRIVATE_KEY/i,
  /-----BEGIN [^-]*PRIVATE KEY-----/i,
  /(?:mnemonic|seed phrase|database_url|session_secret|api[_-]?key|password)\s*=/i,
  /(?:https?|wss?):\/\/[^\s/@:]+:[^\s/@]+@/i,
  /[?&](?:key|token|api[_-]?key|secret|password)=[^\s&"']+/i,
  /(?:worker\.journal|(?:^|[\\/])\.env(?:$|[\\/])|(?:^|[\\/])\.data(?:$|[\\/]))/i,
];

async function copyCuratedEvidence() {
  const sourceRoot = path.resolve(root, 'evidence');
  const outputRoot = path.resolve(root, 'frontend/public/evidence');
  await fs.mkdir(outputRoot, { recursive: true, mode: 0o755 });

  for (const file of CURATED_PUBLIC_EVIDENCE) {
    const source = path.join(sourceRoot, file);
    const target = path.join(outputRoot, file);
    const sourceStat = await fs.lstat(source).catch(() => undefined);
    if (!sourceStat?.isFile()) throw new Error(`required public evidence is missing: evidence/${file}`);
    const contents = await fs.readFile(source, 'utf8');
    try {
      JSON.parse(contents);
    } catch {
      throw new Error(`required public evidence is not valid JSON: evidence/${file}`);
    }
    if (SECRET_MARKERS.some((marker) => marker.test(contents))) {
      throw new Error(`public evidence failed the browser-safety check: evidence/${file}`);
    }
    await fs.copyFile(source, target);
  }

  const outputFiles = (await fs.readdir(outputRoot)).sort();
  const expectedFiles = [...CURATED_PUBLIC_EVIDENCE].sort();
  if (JSON.stringify(outputFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`frontend evidence output is not the explicit allowlist: ${outputFiles.join(', ')}`);
  }
  return outputRoot;
}

async function verifyFrontendOutput(outputRoot) {
  const files = [
    path.join(root, 'frontend/public/index.html'),
    path.join(root, 'frontend/public/styles.css'),
    path.join(root, 'frontend/public/dist/app.js'),
    path.join(root, 'frontend/public/dist/app.js.map'),
    ...CURATED_PUBLIC_EVIDENCE.map((file) => path.join(outputRoot, file)),
  ];
  const actual = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) actual.push(file);
      else throw new Error('frontend output contains a non-regular file');
    }
  }
  await walk(path.join(root, 'frontend/public'));
  if (JSON.stringify(actual.sort()) !== JSON.stringify([...files].sort())) {
    throw new Error('frontend output contains files outside the static allowlist');
  }
  for (const file of files) {
    const contents = await fs.readFile(file, 'utf8').catch(() => {
      throw new Error(`frontend output is missing: ${path.relative(root, file)}`);
    });
    if (SECRET_MARKERS.some((marker) => marker.test(contents))) {
      throw new Error(`frontend output failed the browser-safety check: ${path.relative(root, file)}`);
    }
  }
}

const defaults = {
  botchainChainId: 968,
  botchainMainnetChainId: 677,
  botchainExplorer: 'https://scan.bohr.life/tx/',
  botchainRpc: 'https://rpc.bohr.life',
  faucetUrl: 'https://faucet.botchain.ai/basic',
  sourceRegistry: '0x4E64c9a173440e1375460605b7959C3093370d78',
  sourceRulesHash: '0x7564123213f3cffdfa6237a0067717f6f1a13dc65a0b69e6960cbe5ca8c94331',
  sourceFinalizer: '0x29108bAb564B53B19C5dde4D00048DB6C41e057C',
  prizeToken: '0x5A165Cb40fcF5E97ed7f9af37f45a19C1236f664',
  prizeVault: '0x6edC23FD53d5f861c460397337f505DDF88fCB32',
  botchainSettler: '0x81f6611d25a7533885dd34bce10600aff0E2E4DE',
  prizerailAsc: '0x81f6611d25a7533885dd34bce10600aff0E2E4DE',
  apiBaseUrl: 'http://localhost:3000/api/v1',
  currentWorkerTournamentId: '0x38068ece64fe32ff70d3de7445ec16350ff2f661e13dffbdccd91bbe96f2ae47',
  sepoliaChainId: 968,
  creditcoinChainId: 968,
  attestcoinChainKey: 968,
  sepoliaExplorer: 'https://scan.bohr.life/tx/',
  creditcoinExplorer: 'https://scan.bohr.life/tx/',
};

const envValue = (name, fallback) => process.env[name]?.trim() || fallback;
const envNumber = (name, fallback) => {
  const value = Number(envValue(name, String(fallback)));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
  return value;
};
const apiBaseUrl = envValue('NEXT_PUBLIC_API_BASE_URL', defaults.apiBaseUrl);
let parsedApiUrl;
try {
  parsedApiUrl = new URL(apiBaseUrl);
} catch {
  throw new Error('NEXT_PUBLIC_API_BASE_URL must be an absolute URL ending in /api/v1');
}
if (parsedApiUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(parsedApiUrl.hostname)) {
  throw new Error('NEXT_PUBLIC_API_BASE_URL must use HTTPS outside local development');
}
if (!parsedApiUrl.pathname.replace(/\/$/, '').endsWith('/api/v1')) {
  throw new Error('NEXT_PUBLIC_API_BASE_URL must end in /api/v1');
}
if (parsedApiUrl.username || parsedApiUrl.password || parsedApiUrl.search || parsedApiUrl.hash) {
  throw new Error('NEXT_PUBLIC_API_BASE_URL must not contain credentials, query parameters, or fragments');
}

const publicConfig = {
  botchainChainId: envNumber('NEXT_PUBLIC_BOTCHAIN_CHAIN_ID', defaults.botchainChainId),
  botchainMainnetChainId: envNumber('NEXT_PUBLIC_BOTCHAIN_MAINNET_CHAIN_ID', defaults.botchainMainnetChainId),
  botchainExplorer: envValue('NEXT_PUBLIC_BOTCHAIN_EXPLORER_URL', defaults.botchainExplorer),
  botchainRpc: envValue('NEXT_PUBLIC_BOTCHAIN_RPC_URL', defaults.botchainRpc),
  faucetUrl: defaults.faucetUrl,
  sourceRegistry: envValue('NEXT_PUBLIC_RESULT_REGISTRY_ADDRESS', defaults.sourceRegistry),
  sourceRulesHash: envValue('NEXT_PUBLIC_RESULT_RULES_HASH', defaults.sourceRulesHash),
  sourceFinalizer: envValue('NEXT_PUBLIC_SOURCE_FINALIZER_ADDRESS', defaults.sourceFinalizer),
  prizeToken: envValue('NEXT_PUBLIC_PRIZE_TOKEN_ADDRESS', defaults.prizeToken),
  prizeVault: envValue('NEXT_PUBLIC_PRIZE_VAULT_ADDRESS', defaults.prizeVault),
  botchainSettler: envValue('NEXT_PUBLIC_BOTCHAIN_SETTLER_ADDRESS', defaults.botchainSettler),
  prizerailAsc: envValue('NEXT_PUBLIC_PRIZERAIL_ASC_ADDRESS', defaults.prizerailAsc),
  apiBaseUrl,
  currentWorkerTournamentId: envValue('NEXT_PUBLIC_CURRENT_WORKER_TOURNAMENT_ID', defaults.currentWorkerTournamentId),
  sepoliaChainId: envNumber('NEXT_PUBLIC_BOTCHAIN_CHAIN_ID', defaults.botchainChainId),
  creditcoinChainId: envNumber('NEXT_PUBLIC_BOTCHAIN_CHAIN_ID', defaults.botchainChainId),
  attestcoinChainKey: 968,
  sepoliaExplorer: envValue('NEXT_PUBLIC_BOTCHAIN_EXPLORER_URL', defaults.botchainExplorer),
  creditcoinExplorer: envValue('NEXT_PUBLIC_BOTCHAIN_EXPLORER_URL', defaults.botchainExplorer),
};

await fs.mkdir(path.resolve(root, 'frontend/public/dist'), { recursive: true, mode: 0o755 });

await build({
  entryPoints: ['frontend/src/main.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'frontend/public/dist/app.js',
  sourcemap: true,
  legalComments: 'none',
  define: { __PRIZERAIL_PUBLIC_CONFIG__: JSON.stringify(publicConfig) },
});

const publicEvidenceRoot = await copyCuratedEvidence();
await fs.copyFile('frontend/index.html', 'frontend/public/index.html');
await fs.copyFile('frontend/styles.css', 'frontend/public/styles.css');
await verifyFrontendOutput(publicEvidenceRoot);

console.log(`Frontend output verified at frontend/public; copied ${CURATED_PUBLIC_EVIDENCE.length} curated public evidence files`);
