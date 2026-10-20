import fs from 'node:fs';
import path from 'node:path';
import { Contract, FetchRequest, Interface, JsonRpcProvider, keccak256, toUtf8Bytes } from 'ethers';
import { safeError } from './safe-error.mjs';

const root = process.cwd();
const evidencePath = process.argv[2] ?? 'evidence/live-latest.json';
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
const dotenvLines = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').split(/\n/).map((line) => line.replace(/\r$/, '')) : [];
const env = (name) => {
  const value = process.env[name] ?? dotenvLines.find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1);
  return value?.replace(/\r$/, '') || null;
};
const checks = [];
const stopOnFail = process.env.VERIFY_DEMO_STOP_ON_FAIL === '1';
const check = (name, status, detail) => checks.push({ name, status, detail });
const pass = (name, detail) => check(name, 'PASS', detail);
const fail = (name, detail) => check(name, 'FAIL', detail);
const unknown = (name, detail) => check(name, 'UNKNOWN', detail);
const maybeStop = () => {
  if (!stopOnFail || !checks.some((item) => item.status === 'FAIL')) return;
  source?.destroy?.();
  destination?.destroy?.();
  const overall = 'FAIL';
  console.log(JSON.stringify({ evidence: evidencePath, boundaries: { rawAttestcoinProofReconstruction: 'UNKNOWN: optional verify:proof path' }, checks, overall }, null, 2));
  process.exit(1);
};
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const rpcTimeoutMs = Number(process.env.VERIFY_DEMO_RPC_TIMEOUT_MS ?? 8_000);
const withTimeout = (promise, label, ms = rpcTimeoutMs) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
]);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const artifact = (name) => readJson(path.join(root, 'artifacts', `${name}.json`));
const manifestFor = () => {
  const selected = evidence.deployment?.manifest;
  const file = selected ? path.resolve(root, selected) : path.join(root, 'evidence', 'live-deployment.json');
  if (!fs.existsSync(file)) return { file, manifest: null };
  const raw = readJson(file);
  if (raw.manifestPath) {
    const target = path.resolve(path.dirname(file), raw.manifestPath);
    return { file: target, manifest: fs.existsSync(target) ? readJson(target) : null };
  }
  return { file, manifest: raw };
};
const receipt = async (provider, hash, name) => {
  if (!hash) return unknown(name, 'transaction hash missing');
  try {
    const value = await withTimeout(provider.getTransactionReceipt(hash), name);
    if (!value) return unknown(name, 'receipt not available from public RPC');
    return value;
  } catch (error) {
    unknown(name, safeError(error));
    return null;
  }
};

if (!['live-attestcoin', 'live-worker', 'live-worker-v2'].includes(evidence.mode)) fail('evidence.mode', `expected live-attestcoin, live-worker, or live-worker-v2, got ${evidence.mode}`);
else pass('evidence.mode', evidence.mode === 'live-worker' || evidence.mode === 'live-worker-v2' ? 'live worker evidence selected' : 'live Attestcoin evidence selected');
const sepoliaUrl = env('SEPOLIA_RPC_URL') ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const cc3Url = env('CREDITCOIN_RPC_URL') ?? 'https://rpc.cc3-testnet.creditcoin.network';
if (!sepoliaUrl || !cc3Url) {
  unknown('configuration', 'public RPC URL missing; no private key is used by this verifier');
  console.log(JSON.stringify({ evidence: evidencePath, checks, overall: 'UNKNOWN' }, null, 2));
  process.exit(0);
}

const sourceRequest = new FetchRequest(sepoliaUrl);
sourceRequest.timeout = rpcTimeoutMs;
const destinationRequest = new FetchRequest(cc3Url);
destinationRequest.timeout = rpcTimeoutMs;
const source = new JsonRpcProvider(sourceRequest, 11155111, { staticNetwork: true });
const destination = new JsonRpcProvider(destinationRequest, 102031, { staticNetwork: true });
try {
  const [sourceNetwork, destinationNetwork] = await Promise.all([withTimeout(source.getNetwork(), 'source network'), withTimeout(destination.getNetwork(), 'destination network')]);
  if (Number(sourceNetwork.chainId) === 11155111) pass('source network chain ID', '11155111'); else fail('source network chain ID', `actual=${sourceNetwork.chainId}`);
  if (Number(destinationNetwork.chainId) === 102031) pass('destination network chain ID', '102031'); else fail('destination network chain ID', `actual=${destinationNetwork.chainId}`);
} catch (error) {
  unknown('network chain IDs', safeError(error));
}
const { file: manifestPath, manifest } = manifestFor();
if (!manifest) unknown('deployment manifest', `manifest unavailable: ${manifestPath}`);
else {
  pass('deployment manifest', manifestPath);
  for (const [name, address] of [
    ['source registry', evidence.source.registry],
    ['destination token', evidence.destination.token],
    ['destination vault', evidence.destination.vault],
    ['destination ASC', evidence.destination.asc],
  ]) {
    const expected = name === 'source registry' ? manifest.source?.contract : name === 'destination token' ? manifest.destination?.token?.address : name === 'destination vault' ? manifest.destination?.vault?.address : manifest.destination?.asc?.address;
    if (expected && same(address, expected)) pass(`${name} manifest binding`, address);
    else fail(`${name} manifest binding`, `evidence=${address} manifest=${expected ?? 'missing'}`);
  }
  if (Number(manifest.source?.chainId) === 11155111 && Number(manifest.destination?.chainId) === 102031) pass('manifest network IDs', 'Sepolia=11155111 CC3=102031');
  else fail('manifest network IDs', `source=${manifest.source?.chainId} destination=${manifest.destination?.chainId}`);
}
maybeStop();
const code = async (provider, address, name) => {
  if (!address) return null;
  try {
    const bytes = await withTimeout(provider.getCode(address), name);
    if (bytes && bytes !== '0x') pass(`${name} deployed bytecode`, address); else fail(`${name} deployed bytecode`, 'no code at address');
    return bytes;
  } catch (error) { unknown(`${name} deployed bytecode`, safeError(error)); return null; }
};
const deploymentReceipt = async (provider, entry, name) => {
  if (!entry?.deploymentTx) return unknown(`${name} deployment receipt`, 'deployment transaction missing from manifest');
  const value = await receipt(provider, entry.deploymentTx, `${name} deployment receipt`);
  if (!value) return;
  if (value.status !== 1) return fail(`${name} deployment status`, `status=${value.status}`);
  if (!same(value.contractAddress, entry.address ?? entry.contract)) return fail(`${name} deployment address`, `receipt=${value.contractAddress} manifest=${entry.address ?? entry.contract}`);
  if (entry.deploymentBlock !== undefined && Number(value.blockNumber) !== Number(entry.deploymentBlock)) return fail(`${name} deployment block`, `receipt=${value.blockNumber} manifest=${entry.deploymentBlock}`);
  pass(`${name} deployment receipt`, `status=1 contract=${value.contractAddress} block=${value.blockNumber}`);
};
await code(source, evidence.source.registry, 'source registry');
await code(destination, evidence.destination.token, 'destination token');
await code(destination, evidence.destination.vault, 'destination vault');
await code(destination, evidence.destination.asc, 'destination ASC');
if (manifest) {
  await deploymentReceipt(source, { ...manifest.source, address: manifest.source.contract }, 'source registry');
  await deploymentReceipt(destination, manifest.destination?.token, 'destination token');
  await deploymentReceipt(destination, manifest.destination?.vault, 'destination vault');
  await deploymentReceipt(destination, manifest.destination?.asc, 'destination ASC');
}
const sourceReceipt = await receipt(source, evidence.source.transaction.hash, 'source receipt');
if (sourceReceipt) {
  if (sourceReceipt.status === 1) pass('source receipt status', `status=1 block=${sourceReceipt.blockNumber}`); else fail('source receipt status', `status=${sourceReceipt.status}`);
  if (sourceReceipt.to?.toLowerCase() === evidence.source.registry.toLowerCase()) pass('source contract', evidence.source.registry);
  else fail('source contract', `receipt.to=${sourceReceipt.to}`);
  const sourceInterface = new Interface(artifact('TournamentResultRegistry').abi);
  const parsed = sourceReceipt.logs.map((log) => { try { return { parsed: sourceInterface.parseLog(log), address: log.address }; } catch { return null; } }).find((entry) => entry?.parsed?.name === 'MatchFinalized' && same(entry.address, evidence.source.registry))?.parsed;
  if (!parsed) fail('MatchFinalized event', 'event not found in source receipt');
  else {
    const actual = {
      tournamentId: parsed.args.tournamentId,
      matchId: parsed.args.matchId,
      playerOne: parsed.args.playerOne,
      playerTwo: parsed.args.playerTwo,
      winner: parsed.args.winner,
      result: Number(parsed.args.result),
      rulesHash: parsed.args.rulesHash,
      resultNonce: parsed.args.resultNonce.toString(),
      finalizationStatus: Number(parsed.args.finalizationStatus),
      sourceChainId: Number(parsed.args.sourceChainId),
      finalizedAt: Number(parsed.args.finalizedAt),
      deadline: Number(parsed.args.deadline),
    };
    for (const key of Object.keys(actual)) {
      if (evidence.source.decoded[key] === undefined) unknown(`source decoded ${key}`, 'field missing from evidence bundle');
      else if (String(actual[key]).toLowerCase() === String(evidence.source.decoded[key]).toLowerCase()) pass(`source decoded ${key}`, String(actual[key]));
      else fail(`source decoded ${key}`, `actual=${actual[key]} expected=${evidence.source.decoded[key]}`);
    }
    if (Number(evidence.attestation?.headerNumber) === sourceReceipt.blockNumber) pass('proof/source block binding', `block=${sourceReceipt.blockNumber}`);
    else fail('proof/source block binding', `proofHeader=${evidence.attestation?.headerNumber} sourceBlock=${sourceReceipt.blockNumber}`);
  }
  maybeStop();
}

if (evidence.attestation?.verified === true && /^0x[0-9a-f]{64}$/i.test(evidence.attestation.proofIdentifier ?? '')) pass('recorded Attestcoin proof preflight', `header=${evidence.attestation.headerNumber} proof=${evidence.attestation.proofIdentifier}`);
else fail('recorded Attestcoin proof preflight', 'recorded proof preflight was not verified');
const settlementReceipt = await receipt(destination, evidence.destination.settlement?.hash, 'settlement receipt');
const payoutReceipt = await receipt(destination, evidence.destination.payout?.hash, 'payout receipt');
const replayReceipt = await receipt(destination, evidence.replay?.hash, 'replay receipt');
let claimedAmount = null;
let settledEvent = null;
let verifiedEvent = null;
if (settlementReceipt) {
  if (settlementReceipt.status === 1) pass('settlement receipt', `status=1 block=${settlementReceipt.blockNumber} gas=${settlementReceipt.gasUsed}`); else fail('settlement receipt', `status=${settlementReceipt.status}`);
  if (same(settlementReceipt.to, evidence.destination.asc)) pass('settlement target', evidence.destination.asc); else fail('settlement target', `receipt.to=${settlementReceipt.to}`);
}
if (payoutReceipt) {
  if (payoutReceipt.status === 1) pass('payout receipt', `status=1 block=${payoutReceipt.blockNumber} gas=${payoutReceipt.gasUsed}`); else fail('payout receipt', `status=${payoutReceipt.status}`);
  if (same(payoutReceipt.to, evidence.destination.vault)) pass('payout target', evidence.destination.vault); else fail('payout target', `receipt.to=${payoutReceipt.to}`);
}
if (replayReceipt) {
  if (replayReceipt.status === 0) pass('replay rejected on-chain', `status=0 block=${replayReceipt.blockNumber}`); else fail('replay rejected on-chain', `status=${replayReceipt.status}`);
  if (same(replayReceipt.to, evidence.destination.asc)) pass('replay target', evidence.destination.asc); else fail('replay target', `receipt.to=${replayReceipt.to}`);
}
maybeStop();
const vaultAbi = artifact('PrizeVault').abi;
const vault = new Interface(vaultAbi);
const ascAbi = artifact('PrizeRailASC').abi;
const asc = new Interface(ascAbi);
if (settlementReceipt) {
  const settled = settlementReceipt.logs.map((log) => { try { return { parsed: vault.parseLog(log), address: log.address }; } catch { return null; } }).find((entry) => entry?.parsed?.name === 'TournamentSettled' && same(entry.address, evidence.destination.vault))?.parsed;
  settledEvent = settled;
  if (settled && String(settled.args.tournamentId).toLowerCase() === evidence.source.decoded.tournamentId.toLowerCase() && String(settled.args.winner).toLowerCase() === evidence.source.decoded.winner.toLowerCase()) pass('settlement event binding', `tournament=${settled.args.tournamentId} winner=${settled.args.winner}`);
  else fail('settlement event binding', 'TournamentSettled does not match source evidence');
  const verified = settlementReceipt.logs.map((log) => { try { return { parsed: asc.parseLog(log), address: log.address }; } catch { return null; } }).find((entry) => entry?.parsed?.name === 'ResultVerified' && same(entry.address, evidence.destination.asc))?.parsed;
  verifiedEvent = verified;
  if (verified && same(verified.args.tournamentId, evidence.source.decoded.tournamentId) && same(verified.args.winner, evidence.source.decoded.winner) && String(verified.args.resultNonce) === String(evidence.source.decoded.resultNonce)) pass('ASC result binding', `tournament=${verified.args.tournamentId} nonce=${verified.args.resultNonce}`);
  else fail('ASC result binding', 'ResultVerified does not match source evidence');
} else {
  // A missing settlement receipt means the public dependency is uncertain.
  // Do not turn absent dependent events into semantic failures: the worker
  // and verifier must distinguish an RPC outage from a mined bad transaction.
  unknown('settlement event binding', 'settlement receipt unavailable');
  unknown('ASC result binding', 'settlement receipt unavailable');
}
if (payoutReceipt) {
  const claimed = payoutReceipt.logs.map((log) => { try { return { parsed: vault.parseLog(log), address: log.address }; } catch { return null; } }).find((entry) => entry?.parsed?.name === 'PrizeClaimed' && same(entry.address, evidence.destination.vault))?.parsed;
  if (claimed) claimedAmount = BigInt(claimed.args.amount);
  if (claimed && same(claimed.args.tournamentId, evidence.source.decoded.tournamentId) && same(claimed.args.winner, evidence.source.decoded.winner) && BigInt(claimed.args.amount) > 0n) pass('claim event binding', `winner=${claimed.args.winner} amount=${claimed.args.amount}`);
  else fail('claim event binding', 'PrizeClaimed does not match source winner');
  if (claimedAmount !== null && evidence.destination.amount !== undefined) {
    try {
      if (claimedAmount === BigInt(evidence.destination.amount)) pass('recorded amount-to-claim binding', String(claimedAmount));
      else fail('recorded amount-to-claim binding', `evidence=${evidence.destination.amount} claimed=${claimedAmount}`);
    } catch {
      fail('recorded amount-to-claim binding', `evidence amount is not an integer: ${evidence.destination.amount}`);
    }
  } else if (claimedAmount === null) unknown('recorded amount-to-claim binding', 'PrizeClaimed event unavailable');
} else {
  unknown('claim event binding', 'payout receipt unavailable');
  unknown('recorded amount-to-claim binding', 'payout receipt unavailable');
}
try {
  const vaultContract = new Contract(evidence.destination.vault, vaultAbi, destination);
  const tokenContract = new Contract(evidence.destination.token, artifact('MockPrizeToken').abi, destination);
  const policy = await withTimeout(vaultContract.policies(evidence.source.decoded.tournamentId), 'vault policy read');
  const actualBalance = await withTimeout(tokenContract.balanceOf(evidence.source.decoded.winner), 'winner balance read');
  const recordedBalance = BigInt(evidence.destination.winnerBalance ?? 0);
  if (same(policy.sourceRegistry, evidence.source.registry)) pass('policy source registry binding', policy.sourceRegistry); else fail('policy source registry binding', `policy=${policy.sourceRegistry}`);
  if (Number(policy.sourceChainKey) === Number(evidence.source.chainKey ?? manifest?.source?.chainKey)) pass('policy source chain key', String(policy.sourceChainKey)); else fail('policy source chain key', `policy=${policy.sourceChainKey}`);
  if (same(policy.token, evidence.destination.token)) pass('policy token binding', policy.token); else fail('policy token binding', `policy=${policy.token}`);
  if (same(policy.rulesHash, evidence.source.decoded.rulesHash)) pass('policy rules binding', policy.rulesHash); else fail('policy rules binding', `policy=${policy.rulesHash}`);
  if (String(policy.resultNonce) === String(evidence.source.decoded.resultNonce)) pass('policy nonce binding', String(policy.resultNonce)); else fail('policy nonce binding', `policy=${policy.resultNonce}`);
  if (!settlementReceipt) unknown('settlement source query binding', 'settlement receipt unavailable');
  else if (settledEvent && verifiedEvent && same(settledEvent.args.sourceQueryKey, policy.sourceQueryKey) && same(verifiedEvent.args.sourceQueryKey, policy.sourceQueryKey)) pass('settlement source query binding', policy.sourceQueryKey);
  else fail('settlement source query binding', `policy=${policy.sourceQueryKey} settled=${settledEvent?.args?.sourceQueryKey ?? 'missing'} verified=${verifiedEvent?.args?.sourceQueryKey ?? 'missing'}`);
  if (evidence.destination.amount === undefined) unknown('recorded policy amount', 'amount absent from historical evidence; event-to-policy amount is still checked');
  else if (BigInt(evidence.destination.amount) === BigInt(policy.amount)) pass('recorded policy amount', String(policy.amount));
  else fail('recorded policy amount', `evidence=${evidence.destination.amount} policy=${policy.amount}`);
  if (claimedAmount !== null && claimedAmount === BigInt(policy.amount)) pass('claim amount binding', String(claimedAmount));
  else if (claimedAmount !== null) fail('claim amount binding', `claimed=${claimedAmount} policy=${policy.amount}`);
  else unknown('claim amount binding', 'PrizeClaimed event unavailable');
  if (!payoutReceipt) unknown('winner payout state', 'payout receipt unavailable');
  else if (Number(policy.state) === 3 && claimedAmount !== null && same(policy.winner, evidence.source.decoded.winner) && actualBalance >= BigInt(policy.amount) && recordedBalance > 0n) pass('winner payout state', `CLAIMED currentBalance=${actualBalance} recordedAtRun=${recordedBalance}`);
  else fail('winner payout state', `state=${policy.state} policyWinner=${policy.winner} balance=${actualBalance}`);
  if (manifest) {
    const sourceContract = new Contract(evidence.source.registry, artifact('TournamentResultRegistry').abi, source);
    const ascContract = new Contract(evidence.destination.asc, ascAbi, destination);
    const settlementAuthority = await withTimeout(vaultContract.settlementAuthority(), 'settlement authority read');
    const ascAddress = await ascContract.getAddress();
    if (same(settlementAuthority, ascAddress)) pass('vault settlement authority', settlementAuthority); else fail('vault settlement authority', `${settlementAuthority} != ${ascAddress}`);
    if (manifest.source.finalizer || manifest.source.deployer) {
      const finalizer = await withTimeout(sourceContract.finalizer(), 'source finalizer read');
      if (same(finalizer, manifest.source.finalizer ?? manifest.source.deployer)) pass('source finalizer binding', finalizer); else fail('source finalizer binding', `${finalizer} != ${manifest.source.finalizer ?? manifest.source.deployer}`);
    }
    const sourceChainId = await withTimeout(sourceContract.sourceChainId(), 'source chain ID read');
    if (Number(sourceChainId) === 11155111) pass('source contract chain ID', String(sourceChainId)); else fail('source contract chain ID', String(sourceChainId));
    const expectedKey = await withTimeout(ascContract.expectedSourceChainKey(), 'ASC source chain key read');
    if (Number(expectedKey) === Number(evidence.source.chainKey ?? manifest.source.chainKey)) pass('ASC source chain key', String(expectedKey)); else fail('ASC source chain key', String(expectedKey));
    const boundVault = await withTimeout(ascContract.vault(), 'ASC vault read');
    if (same(boundVault, evidence.destination.vault)) pass('ASC vault binding', boundVault); else fail('ASC vault binding', `${boundVault} != ${evidence.destination.vault}`);
  }
  maybeStop();
} catch (error) {
  unknown('winner payout state', `public state read failed: ${safeError(error)}`);
}
for (const explorer of Object.values(evidence.explorers ?? {})) if (explorer) pass('explorer link', explorer);
const overall = checks.some((item) => item.status === 'FAIL') ? 'FAIL' : checks.some((item) => item.status === 'UNKNOWN') ? 'UNKNOWN' : 'PASS';
source.destroy();
destination.destroy();
console.log(JSON.stringify({ evidence: evidencePath, boundaries: { rawAttestcoinProofReconstruction: 'UNKNOWN: use npm run verify:proof for optional live read-only reconstruction; standard verification checks recorded preflight evidence.' }, checks, overall }, null, 2));
process.exit(overall === 'FAIL' ? 1 : 0);
