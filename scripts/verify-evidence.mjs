/*
 * Evidence verifier.
 *
 * Worker v1 evidence contained operator assertions (for example
 * `restart.demonstrated`) but did not contain enough independently checkable
 * material to establish a restart. Worker v2 derives the important claims
 * from the journal/timeline, runtime activity, hash history, HTTP summaries,
 * repository hashes, and (when reachable) public receipts.
 *
 * This script never reads private keys or raw proof bytes. Public-RPC
 * failures are UNKNOWN; contradictions in a local artifact are FAIL.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  AbiCoder,
  Contract,
  FetchRequest,
  Interface,
  JsonRpcProvider,
  keccak256,
} from 'ethers';

const root = process.cwd();
const file = process.argv[2] ?? 'evidence/local-e2e-run-1.json';
const checks = [];
const add = (name, status, detail) => checks.push({ name, status, detail: String(detail ?? '') });
const pass = (name, detail) => add(name, 'PASS', detail);
const fail = (name, detail) => add(name, 'FAIL', detail);
const unknown = (name, detail) => add(name, 'UNKNOWN', detail);

const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const hashPattern = /^0x[0-9a-f]{64}$/i;
const canonicalEventSignature = 'MatchFinalized(bytes32,bytes32,address,address,address,uint8,bytes32,uint256,uint8,uint64,uint64,uint64)';
const iso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const asNumber = (value) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(n) ? n : null;
};
const readJson = (target) => JSON.parse(fs.readFileSync(target, 'utf8'));
const safeError = (error) => String(error instanceof Error ? error.message : error)
  .replace(/(?:[a-z][a-z0-9+.-]*):\/\/[^\s]+/gi, '[url-redacted]')
  .replace(/(?:PRIVATE_KEY|SESSION_SECRET|DATABASE_URL|API_KEY|TOKEN)=?[^\s,;]*/gi, '[secret-redacted]')
  .replace(/(?:^|[\s'\"])(?:[A-Za-z]:[\\/]|\/)(?:[^\s'\",;)]*)/g, '$1[path-redacted]')
  .replace(/0x[a-f0-9]{40,}/gi, '[hex-redacted]')
  .slice(0, 320);

let evidence;
try {
  evidence = readJson(path.resolve(root, file));
} catch (error) {
  fail('evidence file', safeError(error));
  console.log(JSON.stringify({ file, checks, overall: 'FAIL' }, null, 2));
  process.exit(1);
}

const forbidden = /(?:PRIVATE_KEY|SESSION_SECRET|DATABASE_URL|API[_-]?KEY|ACCESS[_-]?TOKEN|SECRET|txBytes|merkleProof|continuityProof|proofBytes|rawProof\s*:\s*"0x[0-9a-f])/i;
const containsForbidden = (value) => forbidden.test(typeof value === 'string' ? value : JSON.stringify(value));
const txHash = (entry) => typeof entry === 'string' ? entry : entry?.hash ?? entry?.transactionHash ?? null;
const txBlock = (entry) => typeof entry === 'object' && entry !== null ? entry.blockNumber ?? entry.block ?? null : null;
const txStatus = (entry) => typeof entry === 'object' && entry !== null ? entry.status ?? entry.receiptStatus ?? null : null;

function relativeRepoPath(value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) {
    fail(`${label} path`, 'path must be repository-relative');
    return null;
  }
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    fail(`${label} path`, 'path escapes repository root');
    return null;
  }
  const resolved = path.resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    fail(`${label} path`, 'resolved path escapes repository root');
    return null;
  }
  return resolved;
}

function loadManifest(manifestValue) {
  if (!manifestValue) return null;
  const candidate = relativeRepoPath(manifestValue, 'deployment manifest');
  if (!candidate || !fs.existsSync(candidate)) {
    unknown('deployment manifest', `not available: ${manifestValue}`);
    return null;
  }
  try {
    const raw = readJson(candidate);
    if (raw.manifestPath) {
      const target = path.resolve(path.dirname(candidate), raw.manifestPath);
      if (!target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target)) {
        fail('deployment manifest reference', 'manifestPath escapes repository or is missing');
        return null;
      }
      return { value: readJson(target), file: path.relative(root, target) };
    }
    return { value: raw, file: path.relative(root, candidate) };
  } catch (error) {
    fail('deployment manifest', safeError(error));
    return null;
  }
}

const JOB_STATES = new Set([
  'DISCOVERED', 'WAITING_FOR_POLICY', 'MINED', 'AWAITING_ATTESTATION',
  'PROOF_READY', 'PROOF_PREFLIGHT_PASS', 'PROOF_PREFLIGHT_FAIL',
  'SUBMITTING', 'SETTLEMENT_PENDING', 'SETTLEMENT_COMPLETE', 'CLAIMABLE',
  'PAYOUT_PENDING', 'CLAIMED', 'REFUNDED', 'NON_PAYABLE_RESULT',
  'VERIFICATION_FAILED', 'REPLAY_REJECTED', 'ALREADY_SETTLED',
  'INFRASTRUCTURE_UNAVAILABLE', 'UNKNOWN',
]);

// Retry/uncertainty states may return to a prior processing state. Terminal
// business states may not silently jump back to proof acquisition.
const LEGAL = new Map([
  [null, new Set(['DISCOVERED', 'WAITING_FOR_POLICY', 'MINED'])],
  ['DISCOVERED', new Set(['DISCOVERED', 'WAITING_FOR_POLICY', 'MINED', 'NON_PAYABLE_RESULT', 'VERIFICATION_FAILED', 'INFRASTRUCTURE_UNAVAILABLE'])],
  ['WAITING_FOR_POLICY', new Set(['WAITING_FOR_POLICY', 'MINED', 'AWAITING_ATTESTATION', 'NON_PAYABLE_RESULT', 'VERIFICATION_FAILED', 'REFUNDED', 'INFRASTRUCTURE_UNAVAILABLE'])],
  ['MINED', new Set(['MINED', 'AWAITING_ATTESTATION', 'WAITING_FOR_POLICY', 'NON_PAYABLE_RESULT', 'VERIFICATION_FAILED', 'REFUNDED', 'SETTLEMENT_COMPLETE', 'INFRASTRUCTURE_UNAVAILABLE'])],
  ['AWAITING_ATTESTATION', new Set(['AWAITING_ATTESTATION', 'PROOF_READY', 'PROOF_PREFLIGHT_FAIL', 'VERIFICATION_FAILED', 'INFRASTRUCTURE_UNAVAILABLE', 'WAITING_FOR_POLICY'])],
  ['PROOF_READY', new Set(['PROOF_READY', 'PROOF_PREFLIGHT_PASS', 'PROOF_PREFLIGHT_FAIL', 'INFRASTRUCTURE_UNAVAILABLE', 'VERIFICATION_FAILED'])],
  ['PROOF_PREFLIGHT_PASS', new Set(['PROOF_PREFLIGHT_PASS', 'SUBMITTING', 'SETTLEMENT_PENDING', 'SETTLEMENT_COMPLETE', 'INFRASTRUCTURE_UNAVAILABLE', 'VERIFICATION_FAILED'])],
  ['PROOF_PREFLIGHT_FAIL', new Set(['PROOF_PREFLIGHT_FAIL'])],
  ['SUBMITTING', new Set(['SUBMITTING', 'SETTLEMENT_PENDING', 'INFRASTRUCTURE_UNAVAILABLE', 'VERIFICATION_FAILED'])],
  ['SETTLEMENT_PENDING', new Set(['SETTLEMENT_PENDING', 'SETTLEMENT_COMPLETE', 'CLAIMABLE', 'CLAIMED', 'INFRASTRUCTURE_UNAVAILABLE', 'UNKNOWN', 'VERIFICATION_FAILED'])],
  ['SETTLEMENT_COMPLETE', new Set(['SETTLEMENT_COMPLETE', 'CLAIMABLE', 'PAYOUT_PENDING', 'CLAIMED', 'INFRASTRUCTURE_UNAVAILABLE', 'UNKNOWN'])],
  ['CLAIMABLE', new Set(['CLAIMABLE', 'PAYOUT_PENDING', 'CLAIMED', 'REFUNDED', 'INFRASTRUCTURE_UNAVAILABLE', 'UNKNOWN'])],
  ['PAYOUT_PENDING', new Set(['PAYOUT_PENDING', 'CLAIMED', 'REFUNDED', 'INFRASTRUCTURE_UNAVAILABLE', 'UNKNOWN', 'VERIFICATION_FAILED'])],
  ['INFRASTRUCTURE_UNAVAILABLE', new Set([...JOB_STATES].filter((state) => !['CLAIMED', 'REFUNDED', 'PROOF_PREFLIGHT_FAIL', 'NON_PAYABLE_RESULT', 'VERIFICATION_FAILED', 'REPLAY_REJECTED'].includes(state)))],
  ['UNKNOWN', new Set([...JOB_STATES].filter((state) => !['CLAIMED', 'REFUNDED', 'PROOF_PREFLIGHT_FAIL', 'NON_PAYABLE_RESULT', 'VERIFICATION_FAILED', 'REPLAY_REJECTED'].includes(state)))],
  ['CLAIMED', new Set(['CLAIMED'])],
  ['REFUNDED', new Set(['REFUNDED'])],
  ['NON_PAYABLE_RESULT', new Set(['NON_PAYABLE_RESULT'])],
  ['VERIFICATION_FAILED', new Set(['VERIFICATION_FAILED'])],
  ['REPLAY_REJECTED', new Set(['REPLAY_REJECTED'])],
  ['ALREADY_SETTLED', new Set(['ALREADY_SETTLED', 'SETTLEMENT_COMPLETE', 'CLAIMABLE', 'CLAIMED'])],
]);

function snapshotFromEntry(entry, ordinal) {
  const nested = entry?.job ?? entry?.snapshot ?? entry?.record?.job ?? entry;
  return {
    ordinal,
    journalLine: asNumber(entry?.journalLine ?? entry?.line ?? entry?.recordIndex ?? entry?.record?.line),
    revision: asNumber(entry?.revision ?? nested?.revision ?? entry?.sequence ?? entry?.seq),
    at: entry?.at ?? entry?.updatedAt ?? nested?.updatedAt ?? null,
    jobId: nested?.jobId ?? entry?.jobId ?? null,
    state: nested?.state ?? entry?.state ?? null,
    from: entry?.from ?? entry?.transition?.from ?? null,
    to: entry?.to ?? entry?.transition?.to ?? nested?.state ?? entry?.state ?? null,
    settlement: nested?.settlementTransactionHash ?? entry?.settlementTransactionHash ?? entry?.settlementTxHash ?? null,
    payout: nested?.payoutTransactionHash ?? entry?.payoutTransactionHash ?? entry?.payoutTxHash ?? null,
    attemptCount: asNumber(nested?.attemptCount ?? entry?.attemptCount),
    proofAttempt: asNumber(entry?.proofAttempt ?? entry?.proof?.attempt ?? nested?.attemptCount),
    runtimeId: entry?.runtimeId ?? entry?.owner ?? entry?.runtime ?? nested?.runtimeId ?? null,
    sourceTransactionHash: nested?.sourceTransactionHash ?? entry?.sourceTransactionHash ?? null,
    tournamentId: nested?.tournamentId ?? entry?.tournamentId ?? null,
    resultNonce: nested?.resultNonce ?? entry?.resultNonce ?? null,
    raw: entry,
  };
}

function parseJournal(journalPath, targetJobId) {
  const result = { records: [], jobs: [], heartbeats: [], transitions: [], malformed: false, trailingPartial: false };
  let content;
  try { content = fs.readFileSync(journalPath, 'utf8'); }
  catch (error) { return { ...result, unavailable: safeError(error) }; }
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); }
    catch (error) {
      const trailing = index === lines.length - 1 && !content.endsWith('\n');
      if (trailing) result.trailingPartial = true; else result.malformed = true;
      result.records.push({ line: index + 1, parseError: safeError(error), raw: line.slice(0, 200) });
      continue;
    }
    result.records.push({ line: index + 1, record });
    if (!record || typeof record !== 'object' || typeof record.op !== 'string') { result.malformed = true; continue; }
    if (record.op === 'heartbeat') {
      if (record.heartbeat?.owner && iso(record.heartbeat?.at)) result.heartbeats.push({ ...record.heartbeat, line: index + 1 });
      else result.malformed = true;
    } else if (record.op === 'job' && record.job?.jobId === targetJobId) {
      const snapshot = snapshotFromEntry({ ...record.job, record, journalLine: index + 1 }, result.jobs.length + 1);
      snapshot.raw = record.job;
      result.jobs.push(snapshot);
      if (!JOB_STATES.has(snapshot.state)) result.malformed = true;
      if (record.transition?.jobId === targetJobId) result.transitions.push({ ...record.transition, line: index + 1 });
    } else if (record.op === 'transition' && record.transition?.jobId === targetJobId) {
      result.transitions.push({ ...record.transition, line: index + 1 });
      if (!JOB_STATES.has(record.transition.to) || (record.transition.from !== null && !JOB_STATES.has(record.transition.from))) result.malformed = true;
    }
  }
  return result;
}

// v2 evidence may carry a sanitized, checked-in copy of the journal records.
// This is required for a fresh checkout because `.data` is intentionally
// ignored and must not be the sole witness for a restart.  The same parser is
// used for on-disk and embedded records so the derivation rules are identical.
function parseEmbeddedJournal(value, targetJobId) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(value?.records)
      ? value.records
      : Array.isArray(value?.journal)
        ? value.journal
        : [];
  const result = { records: [], jobs: [], heartbeats: [], transitions: [], malformed: false, trailingPartial: false };
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index];
    const line = asNumber(item?.line ?? item?.journalLine ?? item?.lineNumber) ?? index + 1;
    const record = item?.record && typeof item.record === 'object' ? item.record : item;
    result.records.push({ line, record });
    if (!record || typeof record !== 'object' || typeof record.op !== 'string') { result.malformed = true; continue; }
    if (record.op === 'heartbeat') {
      if (record.heartbeat?.owner && iso(record.heartbeat?.at)) result.heartbeats.push({ ...record.heartbeat, line });
      else result.malformed = true;
    } else if (record.op === 'job' && record.job?.jobId === targetJobId) {
      const snapshot = snapshotFromEntry({ ...record.job, record, journalLine: line }, result.jobs.length + 1);
      snapshot.raw = record.job;
      result.jobs.push(snapshot);
      if (!JOB_STATES.has(snapshot.state)) result.malformed = true;
      if (record.transition?.jobId === targetJobId) result.transitions.push({ ...record.transition, line });
    } else if (record.op === 'transition' && record.transition?.jobId === targetJobId) {
      result.transitions.push({ ...record.transition, line });
      if (!JOB_STATES.has(record.transition.to) || (record.transition.from !== null && !JOB_STATES.has(record.transition.from))) result.malformed = true;
    }
  }
  return result;
}

function checkStopMarker(evidence, worker, restart) {
  const stopMarker = restart.stopMarker ?? restart.stop ?? evidence.stopMarker;
  if (!stopMarker || typeof stopMarker !== 'object') return;
  const markerPathValue = stopMarker.path ?? stopMarker.file;
  // The inline marker is the portable evidence. A path is optional because
  // the live durable-state directory is intentionally ignored by Git.
  let marker = stopMarker;
  if (markerPathValue) {
    const markerPath = relativeRepoPath(markerPathValue, 'stop marker');
    if (markerPath && fs.existsSync(markerPath)) {
      try {
        const diskMarker = readJson(markerPath);
        for (const field of ['type', 'runId', 'runtimeId', 'pid', 'requestedAt', 'stoppedAt', 'exitCode', 'signal', 'confirmed', 'jobId', 'stateAtStop', 'revisionAtStop']) {
          if (diskMarker[field] !== undefined && marker[field] !== undefined && String(diskMarker[field]) !== String(marker[field])) fail(`stop marker ${field} consistency`, 'inline and durable marker differ');
        }
      } catch (error) { unknown('stop marker durable file', safeError(error)); }
    } else {
      pass('stop marker portability', 'ignored durable-state marker is absent; inline marker is embedded in the evidence bundle');
    }
  }
  if (marker.type !== 'worker_stop_marker') fail('stop marker type', `unexpected type ${marker.type}`);
  if (marker.confirmed !== true) fail('stop marker confirmation', 'marker.confirmed is not true');
  else pass('stop marker confirmation', 'portable marker confirms process termination');
  if (marker.jobId !== worker.jobId) fail('stop marker job binding', `marker=${marker.jobId} worker=${worker.jobId}`);
  if (marker.runtimeId !== (restart.firstRuntimeId ?? restart.firstRuntime)) fail('stop marker runtime binding', 'marker runtime does not match first runtime');
  const markerPid = asNumber(marker.pid);
  if (markerPid === null || markerPid <= 0) fail('stop marker PID', 'marker PID is invalid');
  const exited = marker.exitCode !== null && marker.exitCode !== undefined || typeof marker.signal === 'string' && marker.signal.length > 0;
  if (!exited) fail('stop marker exit status', 'marker has neither exitCode nor signal');
  if (!iso(marker.requestedAt) || !iso(marker.stoppedAt) || Date.parse(marker.stoppedAt) < Date.parse(marker.requestedAt)) fail('stop marker timestamps', 'requestedAt/stoppedAt are invalid or unordered');
  const declaredStop = restart.stopAt ?? restart.stoppedAt;
  if (declaredStop && iso(marker.stoppedAt) && Date.parse(marker.stoppedAt) !== Date.parse(declaredStop)) fail('stop marker timestamp binding', 'marker stoppedAt differs from restart.stopAt');
  else if (iso(marker.stoppedAt)) pass('stop marker timestamp binding', marker.stoppedAt);
}

function checkHashHistory(snapshots, label) {
  let assigned = null;
  let assignedAt = null;
  const seen = [];
  let okay = true;
  for (const snapshot of snapshots) {
    const value = snapshot[label];
    if (value !== null && value !== undefined && !hashPattern.test(String(value))) {
      fail(`${label} format`, `invalid hash at revision ${snapshot.revision ?? snapshot.ordinal}`);
      okay = false;
      continue;
    }
    if (value === null || value === undefined) {
      if (assigned !== null) {
        fail(`${label} immutable history`, `assigned ${assigned} was cleared at revision ${snapshot.revision ?? snapshot.ordinal}`);
        okay = false;
      }
      continue;
    }
    const normalized = String(value).toLowerCase();
    seen.push(normalized);
    if (assigned === null) { assigned = normalized; assignedAt = snapshot.at; }
    else if (assigned !== normalized) {
      fail(`${label} immutable history`, `identity changed from ${assigned} to ${normalized}`);
      okay = false;
    }
  }
  if (okay) pass(`${label} immutable history`, assigned ? `one identity assigned at ${assignedAt ?? 'unknown time'}` : 'no identity assigned');
  return { okay, assigned, unique: [...new Set(seen)] };
}

function checkSourceHashes(sourceHashes) {
  const value = sourceHashes && typeof sourceHashes === 'object' ? sourceHashes : null;
  if (!value) { fail('source-version binding', 'v2 evidence has no sourceHashes object'); return; }
  const algorithm = String(value.algorithm ?? 'sha256').toLowerCase();
  if (!['sha256', 'sha-256'].includes(algorithm)) fail('source-version algorithm', `unsupported algorithm ${algorithm}`);
  const git = value.git && typeof value.git === 'object' ? value.git : {};
  const provenance = String(value.gitProvenance ?? value.provenance ?? git.provenance ?? 'UNKNOWN').toUpperCase();
  const commit = value.gitCommit ?? value.commit ?? git.commit ?? null;
  if (provenance === 'UNKNOWN') {
    if (commit) fail('source-version Git provenance', 'gitProvenance=UNKNOWN cannot include a commit claim');
    else pass('source-version Git provenance', 'UNKNOWN explicitly recorded; file hashes are authoritative');
  } else if (commit) {
    try {
      const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (actual.toLowerCase() === String(commit).toLowerCase()) pass('source-version Git commit', actual);
      else fail('source-version Git commit', `actual=${actual} evidence=${commit}`);
    } catch (error) { fail('source-version Git commit', `cannot verify claimed commit: ${safeError(error)}`); }
  } else unknown('source-version Git provenance', `provenance=${provenance} but no commit was recorded`);
  let entries = value.files ?? value.fileHashes ?? value.hashes;
  if (Array.isArray(entries)) entries = Object.fromEntries(entries.map((entry) => [entry.path ?? entry.file, entry.sha256 ?? entry.hash ?? entry.digest]));
  if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
    entries = Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, entry && typeof entry === 'object' ? entry.sha256 ?? entry.hash ?? entry.digest : entry]));
  }
  if (!entries || typeof entries !== 'object' || Object.keys(entries).length === 0) { fail('source-version file hashes', 'no SHA-256 file entries'); return; }
  const baseline = [
    'src/worker-runtime.ts', 'src/durable-store.ts', 'src/api.ts', 'src/worker-types.ts',
    'src/adapter.ts', 'src/attestcoin.ts', 'scripts/worker.ts', 'scripts/api.ts',
    'scripts/live-worker.ts', 'artifacts/PrizeRailASC.json', 'artifacts/PrizeVault.json',
    'artifacts/TournamentResultRegistry.json', 'evidence/current-deployment.json', 'package.json',
  ];
  const missingBaseline = baseline.filter((item) => entries[item] === undefined);
  if (missingBaseline.length) fail('source-version load-bearing coverage', `missing ${missingBaseline.join(', ')}`);
  let all = true;
  for (const [relative, expected] of Object.entries(entries)) {
    const target = relativeRepoPath(relative, `source hash ${relative}`);
    if (!target) { all = false; continue; }
    if (!fs.existsSync(target)) { fail(`source hash ${relative}`, 'file is missing'); all = false; continue; }
    const expectedText = String(expected).replace(/^0x/, '');
    if (!/^[0-9a-f]{64}$/i.test(expectedText)) { fail(`source hash ${relative}`, 'expected SHA-256 is not a 64-byte hex digest'); all = false; continue; }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    if (actual.toLowerCase() === expectedText.toLowerCase()) pass(`source hash ${relative}`, actual);
    else { fail(`source hash ${relative}`, `actual=${actual} evidence=${expected}`); all = false; }
  }
  if (all && !missingBaseline.length) pass('source-version binding', `${Object.keys(entries).length} repository files matched SHA-256`);
}

function normalizeHttpEntries(value) {
  let source;
  if (Array.isArray(value)) source = value;
  else if (value && typeof value === 'object') {
    const objectValue = value;
    const grouped = ['requests', 'responses', 'summaries', 'beforeRestart', 'afterRestart', 'before', 'after', 'initial', 'final']
      .flatMap((key) => Array.isArray(objectValue[key]) ? objectValue[key] : []);
    source = grouped.length ? grouped : Object.values(objectValue);
  } else source = [];
  return source.map((entry, index) => {
    const request = entry?.request && typeof entry.request === 'object' ? entry.request : entry;
    const response = entry?.response && typeof entry.response === 'object' ? entry.response : entry;
    const headers = response?.headers && typeof response.headers === 'object'
      ? response.headers
      : entry?.headers && typeof entry.headers === 'object'
        ? entry.headers
        : {};
    if (entry?.cors && typeof entry.cors === 'object') {
      if (entry.cors.allowOrigin !== undefined) headers['access-control-allow-origin'] ??= entry.cors.allowOrigin;
      if (entry.cors.allowMethods !== undefined) headers['access-control-allow-methods'] ??= entry.cors.allowMethods;
      if (entry.cors.allowHeaders !== undefined) headers['access-control-allow-headers'] ??= entry.cors.allowHeaders;
    }
    const recordedUrl = request?.url ?? entry?.url ?? null;
    let effectivePath = String(request?.path ?? request?.pathname ?? entry?.path ?? entry?.pathname ?? '');
    // The live runner records route-relative paths alongside the full socket URL.
    // Derive the effective API pathname so portable evidence is checked against
    // the actual HTTP request target without weakening the /api/v1 requirement.
    if (recordedUrl && !effectivePath.startsWith('/api/v1/')) {
      try {
        const urlPath = new URL(recordedUrl).pathname;
        if (urlPath.startsWith('/api/v1/')) effectivePath = urlPath;
      } catch {
        // URL syntax is checked by the transport/path assertions below.
      }
    }
    return {
      index,
      phase: String(entry?.phase ?? entry?.stage ?? '').toLowerCase(),
      transport: String(entry?.transport ?? request?.transport ?? '').toLowerCase(),
      method: String(request?.method ?? entry?.method ?? '').toUpperCase(),
      path: effectivePath,
      url: recordedUrl,
      status: asNumber(response?.status ?? entry?.status),
      headers,
      body: response?.body ?? entry?.body ?? entry?.bodySummary ?? null,
      raw: entry,
    };
  });
}

function header(headers, name) {
  const wanted = name.toLowerCase();
  const found = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === wanted);
  return found ? String(found[1]) : null;
}

function checkHttpEvidence(evidence, jobId) {
  const entries = normalizeHttpEntries(evidence.http ?? evidence.httpEvidence ?? evidence.httpRequests ?? evidence.worker?.http ?? evidence.worker?.httpEvidence ?? evidence.worker?.httpRequests);
  if (!entries.length) { fail('HTTP evidence', 'v2 evidence has no request/response summaries'); return; }
  const phases = new Set();
  const routes = new Set();
  let socketCount = 0;
  let sanitized = true;
  for (const item of entries) {
    if (item.phase) phases.add(item.phase);
    if (item.path) routes.add(item.path);
    if (item.transport === 'socket' || item.transport === 'http' || /^https?:\/\/127\.0\.0\.1(?::\d+)?\//.test(String(item.url ?? ''))) socketCount += 1;
    if (!item.method || !item.path || item.status === null) { fail(`HTTP entry ${item.index}`, 'method/path/status missing'); continue; }
    const expectedMethod = ['GET', 'OPTIONS'].includes(item.method) || (item.method === 'POST' && item.status === 405);
    if (!expectedMethod) fail(`HTTP entry ${item.index} method`, `unexpected ${item.method}`);
    if (!item.path.startsWith('/api/v1/')) fail(`HTTP entry ${item.index} path`, 'path is not under /api/v1');
    if (containsForbidden(item.raw)) { fail(`HTTP entry ${item.index} redaction`, 'credential, path, or raw-proof material found'); sanitized = false; }
    const contentType = header(item.headers, 'content-type');
    if (item.status !== 204 && !contentType) fail(`HTTP entry ${item.index} content type`, 'Content-Type header missing');
    else if (item.status !== 204 && !/^application\/json(?:;|$)/i.test(contentType)) fail(`HTTP entry ${item.index} content type`, contentType);
    const bodyText = JSON.stringify(item.body ?? {});
    if (/rawProof\s*[:=]\s*(?!null)/i.test(bodyText) || /(?:txBytes|merkleProof|continuityProof|PRIVATE_KEY|SESSION_SECRET|DATABASE_URL)/i.test(bodyText)) {
      fail(`HTTP entry ${item.index} browser redaction`, 'raw proof or credential-like field is present'); sanitized = false;
    }
    if (item.path.includes('/proof-jobs/') && item.path.endsWith(jobId) && item.body?.jobId && item.body.jobId !== jobId) fail(`HTTP entry ${item.index} job binding`, `body jobId=${item.body.jobId}`);
    if (item.body?.attestcoin && item.body.attestcoin.rawProof !== undefined && item.body.attestcoin.rawProof !== null) {
      fail(`HTTP entry ${item.index} raw proof`, 'attestcoin.rawProof must be null'); sanitized = false;
    }
  }
  for (const route of ['/health', '/config']) if (![...routes].some((candidate) => candidate === `/api/v1${route}` || candidate.endsWith(route))) fail('HTTP route coverage', `missing ${route}`);
  if (![...routes].some((route) => route.includes('/proof-jobs/') && route.endsWith(jobId))) fail('HTTP route coverage', 'missing valid genuine-job route');
  if (![...routes].some((route) => route.includes('/proof-jobs/') && !route.endsWith(jobId))) fail('HTTP route coverage', 'missing invalid/missing job route');
  if (![...routes].some((route) => route.includes('/evidence') || route.includes('/status'))) fail('HTTP route coverage', 'missing evidence/policy projection route');
  if (!entries.some((entry) => entry.status === 405 && entry.method !== 'GET')) fail('HTTP method rejection', 'missing recorded 405 method rejection');
  if (!entries.some((entry) => entry.method === 'OPTIONS' && entry.status === 204)) fail('HTTP CORS preflight', 'missing OPTIONS 204 response');
  const corsEntries = entries.filter((entry) => entry.method === 'GET' || entry.method === 'OPTIONS');
  if (!corsEntries.some((entry) => header(entry.headers, 'access-control-allow-origin'))) fail('HTTP CORS header', 'no Access-Control-Allow-Origin response header recorded');
  if (!entries.some((entry) => entry.method === 'OPTIONS' && header(entry.headers, 'access-control-allow-methods')?.includes('GET') && header(entry.headers, 'access-control-allow-headers')?.toLowerCase().includes('accept'))) fail('HTTP CORS policy', 'preflight did not record allowed GET/Accept headers');
  if (socketCount === 0) fail('HTTP transport', 'no entry proves an actual localhost socket transport');
  else pass('HTTP transport', `${socketCount} socket request summaries`);
  if (sanitized) pass('HTTP browser-safe redaction', 'no raw proof, credential, or local path material found');
  const before = entries.filter((entry) => /before|pre.?restart|initial/.test(entry.phase));
  const after = entries.filter((entry) => /after|post.?restart|complete|final/.test(entry.phase));
  if (before.length && after.length) pass('HTTP restart projections', `before=${before.length} after=${after.length}`);
  else fail('HTTP restart projections', 'genuine job was not queried before and after restart/completion');
}

function checkRuntimesAndTimeline(evidence, journalData) {
  const worker = evidence.worker ?? {};
  const restart = worker.restart ?? worker.stopRestart ?? evidence.restart ?? {};
  const storeIdentity = worker.storeId ?? worker.storeIdentity ?? worker.storePathId ?? restart.storeId ?? restart.storeIdentity;
  const firstStoreIdentity = restart.firstStoreId ?? restart.firstStoreIdentity ?? restart.before?.storeId;
  const secondStoreIdentity = restart.secondStoreId ?? restart.secondStoreIdentity ?? restart.after?.storeId;
  if (!storeIdentity && !firstStoreIdentity && !secondStoreIdentity) {
    fail('same durable store identity', 'fresh evidence has no stable store identity');
  } else if ((firstStoreIdentity && secondStoreIdentity && firstStoreIdentity !== secondStoreIdentity)
    || (storeIdentity && firstStoreIdentity && storeIdentity !== firstStoreIdentity)
    || (storeIdentity && secondStoreIdentity && storeIdentity !== secondStoreIdentity)) {
    fail('same durable store identity', 'first and second runtimes point at different stores');
  } else {
    pass('same durable store identity', String(storeIdentity ?? firstStoreIdentity ?? secondStoreIdentity));
  }
  const firstDataDirectory = restart.firstDataDirectory ?? restart.before?.dataDirectory;
  const secondDataDirectory = restart.secondDataDirectory ?? restart.after?.dataDirectory;
  if (firstDataDirectory && secondDataDirectory && path.normalize(String(firstDataDirectory)) !== path.normalize(String(secondDataDirectory))) fail('same durable store path', 'first and second runtimes report different data directories');
  else if (firstDataDirectory || secondDataDirectory) pass('same durable store path', String(firstDataDirectory ?? secondDataDirectory));
  const runtimeRows = worker.runtimes ?? worker.runtimeTimeline ?? restart.runtimes ?? [];
  const runtimeIds = new Set();
  const activities = [];
  for (const row of Array.isArray(runtimeRows) ? runtimeRows : []) {
    const id = row?.runtimeId ?? row?.id ?? row?.owner;
    if (typeof id === 'string' && id) runtimeIds.add(id);
    const activityRows = Array.isArray(row?.activity) ? row.activity : [];
    for (const at of [row?.startedAt, row?.stoppedAt, row?.heartbeatAt, ...activityRows.map((item) => item?.at ?? item)]) {
      if (iso(at)) activities.push({ runtimeId: id, at: Date.parse(at), source: 'evidence' });
    }
  }
  for (const heartbeat of journalData.heartbeats) {
    runtimeIds.add(heartbeat.owner);
    activities.push({ runtimeId: heartbeat.owner, at: Date.parse(heartbeat.at), source: 'journal', line: heartbeat.line });
  }
  const firstId = restart.firstRuntimeId ?? restart.firstRuntime ?? worker.firstRuntimeId;
  const secondId = restart.secondRuntimeId ?? restart.secondRuntime ?? worker.secondRuntimeId;
  const stopAtValue = restart.stopAt ?? restart.stoppedAt ?? worker.stopAt ?? worker.stoppedAt;
  const restartAtValue = restart.restartAt ?? restart.resumedAt ?? restart.secondStartedAt ?? worker.restartAt;
  const stopAt = Date.parse(stopAtValue ?? '');
  const restartAt = Date.parse(restartAtValue ?? '');
  if (runtimeIds.size < 2) fail('restart runtime identities', `only ${runtimeIds.size} distinct runtime identities were observed`);
  else pass('restart runtime identities', [...runtimeIds].join(', '));
  if (!firstId || !secondId || firstId === secondId) fail('restart runtime identity binding', 'first and second runtime IDs are missing or equal');
  else if (!runtimeIds.has(firstId) || !runtimeIds.has(secondId)) fail('restart runtime identity binding', 'declared IDs are not present in heartbeat/runtime activity');
  else pass('restart runtime identity binding', `${firstId} -> ${secondId}`);
  if (!Number.isFinite(stopAt) || !Number.isFinite(restartAt) || stopAt >= restartAt) fail('restart timestamps', 'explicit stopAt/restartAt are missing or unordered');
  else pass('restart timestamps', `${new Date(stopAt).toISOString()} -> ${new Date(restartAt).toISOString()}`);
  const stopMarker = restart.stopMarker ?? restart.stop ?? evidence.stopMarker ?? {};
  checkStopMarker(evidence, worker, restart);
  const processConfirmed = restart.processStopConfirmed ?? restart.processExited ?? stopMarker.confirmed;
  const stopPid = asNumber(stopMarker.pid ?? restart.stoppedPid ?? restart.firstPid);
  const stopExitCode = stopMarker.exitCode ?? restart.exitCode;
  const stopSignal = stopMarker.signal ?? restart.signal;
  if (processConfirmed !== true) fail('process stop marker', 'explicit confirmed process-stop marker is missing');
  else if (stopPid === null || (stopExitCode === null && !stopSignal)) fail('process stop marker', 'confirmation lacks stopped PID and exit status/signal');
  else pass('process stop marker', `pid=${stopPid} ${stopExitCode !== null && stopExitCode !== undefined ? `exitCode=${stopExitCode}` : `signal=${stopSignal}`}`);
  if (Number.isFinite(stopAt) && Number.isFinite(restartAt) && firstId && secondId) {
    const firstBefore = activities.some((item) => item.runtimeId === firstId && item.at <= stopAt);
    const firstAfter = activities.some((item) => item.runtimeId === firstId && item.at > stopAt);
    const secondAfter = activities.some((item) => item.runtimeId === secondId && item.at >= restartAt);
    if (firstBefore) pass('first runtime activity before stop', 'heartbeat/activity observed before stop marker');
    else fail('first runtime activity before stop', 'no first-runtime activity before stop marker');
    if (firstAfter) fail('first runtime stopped', 'first runtime emitted activity after stop marker');
    else pass('first runtime stopped', 'no first-runtime activity after stop marker');
    if (secondAfter) pass('second runtime activity after restart', 'heartbeat/activity observed after restart marker');
    else fail('second runtime activity after restart', 'no second-runtime activity after restart marker');
  }
  const suppliedTimelineRaw = worker.timeline ?? worker.journalTimeline ?? worker.jobTimeline ?? worker.revisions;
  const suppliedTimeline = Array.isArray(suppliedTimelineRaw) ? suppliedTimelineRaw.map((entry, index) => snapshotFromEntry(entry, index + 1)) : [];
  // Prefer the complete embedded journal sequence as the authority. The
  // recorder's summarized timeline is checked against it below, but cannot
  // hide an omitted clearing mutation or illegal transition.
  const timeline = journalData.jobs.length
    ? journalData.jobs.map((entry, index) => ({ ...entry, revision: entry.revision ?? index + 1 }))
    : suppliedTimeline;
  if (journalData.jobs.length && suppliedTimeline.length !== timeline.length) fail('timeline completeness', `embedded journal=${timeline.length} snapshots, supplied timeline=${suppliedTimeline.length}`);
  if (journalData.jobs.length && suppliedTimeline.length === timeline.length) {
    for (let index = 0; index < timeline.length; index += 1) {
      const canonical = timeline[index];
      const supplied = suppliedTimeline[index];
      if (canonical.journalLine !== supplied.journalLine || canonical.state !== supplied.state || !same(canonical.settlement, supplied.settlement) || !same(canonical.payout, supplied.payout)) {
        fail('timeline completeness', `supplied timeline diverges from embedded journal at ordinal ${index + 1}`);
      }
    }
  }
  if (!timeline.length) {
    fail('job revision timeline', 'v2 evidence has no timeline snapshots');
    return { timeline, runtimeIds, firstId, secondId, stopAt, restartAt };
  }
  let previousRevision = 0;
  let previousState = null;
  let previousAt = -Infinity;
  let previousLine = 0;
  let sourceIdentity = null;
  let businessIdentity = null;
  let timelineOkay = true;
  for (const row of timeline) {
    if (row.jobId !== worker.jobId) { fail('timeline job identity', `entry ${row.ordinal} points to ${row.jobId}`); timelineOkay = false; }
    if (!row.revision || row.revision <= previousRevision) { fail('job revision monotonicity', `revision ${row.revision} follows ${previousRevision}`); timelineOkay = false; }
    previousRevision = row.revision ?? previousRevision;
    if (!JOB_STATES.has(row.state)) { fail('job state validity', `unknown state ${row.state}`); timelineOkay = false; }
    const from = row.from ?? previousState;
    const to = row.to ?? row.state;
    if (to !== row.state) { fail('timeline state binding', `to=${to} state=${row.state}`); timelineOkay = false; }
    const allowed = LEGAL.get(from);
    if (allowed && !allowed.has(to)) { fail('legal state transitions', `${from ?? 'null'} -> ${to}`); timelineOkay = false; }
    if (!iso(row.at)) { fail('timeline timestamps', `invalid timestamp at revision ${row.revision}`); timelineOkay = false; }
    else if (Date.parse(row.at) < previousAt) { fail('timeline timestamp order', `revision ${row.revision} precedes an earlier timestamp`); timelineOkay = false; }
    else previousAt = Date.parse(row.at);
    if (row.journalLine !== null) {
      if (row.journalLine <= previousLine) { fail('timeline journal order', `line ${row.journalLine} follows ${previousLine}`); timelineOkay = false; }
      previousLine = row.journalLine;
    }
    if (row.sourceTransactionHash) {
      const identity = String(row.sourceTransactionHash).toLowerCase();
      if (sourceIdentity === null) sourceIdentity = identity;
      else if (sourceIdentity !== identity) { fail('source identity immutability', `source transaction changed at revision ${row.revision}`); timelineOkay = false; }
    }
    if (row.tournamentId && row.resultNonce !== null && row.resultNonce !== undefined) {
      const identity = `${String(row.tournamentId).toLowerCase()}:${String(row.resultNonce)}`;
      if (businessIdentity === null) businessIdentity = identity;
      else if (businessIdentity !== identity) { fail('business identity immutability', `tournament/nonce changed at revision ${row.revision}`); timelineOkay = false; }
    }
    previousState = row.state;
  }
  if (timelineOkay) pass('job revision/state timeline', `${timeline.length} ordered snapshots independently checked`);
  if (journalData.records.length && timeline.some((row) => row.journalLine !== null)) {
    for (const row of timeline) {
      if (row.journalLine === null) continue;
      const record = journalData.records.find((candidate) => candidate.line === row.journalLine)?.record;
      if (!record || record.op !== 'job' || record.job?.jobId !== worker.jobId) {
        fail('timeline journal binding', `revision ${row.revision} does not bind to target job record at line ${row.journalLine}`);
      } else {
        const journalState = record.job?.state;
        const journalSettlement = record.job?.settlementTransactionHash ?? null;
        const journalPayout = record.job?.payoutTransactionHash ?? null;
        if (journalState !== row.state) fail('timeline journal state binding', `line ${row.journalLine} state=${journalState} timeline=${row.state}`);
        if (!same(journalSettlement, row.settlement)) fail('timeline journal settlement binding', `line ${row.journalLine} hash differs from timeline`);
        if (!same(journalPayout, row.payout)) fail('timeline journal payout binding', `line ${row.journalLine} hash differs from timeline`);
      }
    }
  }
  const meaningfulBeforeStop = timeline.some((row) => row.state === 'AWAITING_ATTESTATION' && row.attemptCount !== null && row.attemptCount >= 1 && Number.isFinite(stopAt) && Date.parse(row.at) <= stopAt);
  if (meaningfulBeforeStop) pass('meaningful pre-stop processing state', 'AWAITING_ATTESTATION with a proof attempt before stop');
  else fail('meaningful pre-stop processing state', 'no AWAITING_ATTESTATION proof attempt before stop marker');
  const resumedSnapshot = timeline.some((row) => Number.isFinite(restartAt) && Date.parse(row.at) >= restartAt && row.jobId === worker.jobId);
  if (resumedSnapshot) pass('same job resumed after restart', worker.jobId);
  else fail('same job resumed after restart', 'no target-job snapshot after restart marker');
  const proofAttempts = timeline.map((row) => ({ value: row.proofAttempt ?? row.attemptCount, at: Date.parse(row.at) })).filter((item) => item.value !== null && item.value !== undefined).map((item) => ({ ...item, value: Number(item.value) })).filter((item) => Number.isFinite(item.value));
  if (proofAttempts.some((item) => item.value >= 1) && proofAttempts.some((item) => item.value >= 2 && Number.isFinite(restartAt) && item.at >= restartAt)) pass('proof-attempt history', `attempts ${[...new Set(proofAttempts.map((item) => item.value))].join(', ')}`);
  else fail('proof-attempt history', 'proof attempts do not show pre-stop and post-restart activity');
  const journalSnapshots = journalData.jobs.map((row, index) => ({ ...row, revision: row.revision ?? index + 1 }));
  // Check both the portable timeline and the full journal snapshots. This is
  // important when an operator accidentally omits a clearing mutation from a
  // hand-curated timeline: the immutable-hash invariant must still fail.
  const settlementHistory = checkHashHistory(timeline, 'settlement');
  const payoutHistory = checkHashHistory(timeline, 'payout');
  if (journalSnapshots.length) {
    const journalSettlementHistory = checkHashHistory(journalSnapshots, 'settlement');
    const journalPayoutHistory = checkHashHistory(journalSnapshots, 'payout');
    if (journalSettlementHistory.assigned !== settlementHistory.assigned) fail('journal/timeline settlement identity', 'derived identities differ');
    if (journalPayoutHistory.assigned !== payoutHistory.assigned) fail('journal/timeline payout identity', 'derived identities differ');
  }
  const finalSettlement = settlementHistory.assigned;
  const finalPayout = payoutHistory.assigned;
  const destinationSettlement = txHash(evidence.destination?.settlement);
  const destinationPayout = txHash(evidence.destination?.payout);
  if (finalSettlement && destinationSettlement && same(finalSettlement, destinationSettlement)) pass('settlement hash binding', finalSettlement);
  else fail('settlement hash binding', `timeline=${finalSettlement ?? 'missing'} evidence=${destinationSettlement ?? 'missing'}`);
  if (finalPayout && destinationPayout && same(finalPayout, destinationPayout)) pass('payout hash binding', finalPayout);
  else fail('payout hash binding', `timeline=${finalPayout ?? 'missing'} evidence=${destinationPayout ?? 'missing'}`);
  if (settlementHistory.unique.length <= 1 && payoutHistory.unique.length <= 1) pass('at-most-one settlement/payout identity', `settlement=${settlementHistory.unique.length} payout=${payoutHistory.unique.length}`);
  else fail('at-most-one settlement/payout identity', `settlement=${settlementHistory.unique.length} payout=${payoutHistory.unique.length}`);
  const assignments = worker.hashAssignments ?? {};
  for (const [name, expected] of [['settlement', finalSettlement], ['payout', finalPayout]]) {
    const values = assignments[name] ?? assignments[`${name}Tx`] ?? [];
    if (!Array.isArray(values) || !values.length) fail(`${name} assignment evidence`, `missing explicit ${name} assignment history`);
    else {
      const hashes = [...new Set(values.map((entry) => String(entry?.hash ?? entry?.transactionHash ?? entry).toLowerCase()))];
      const malformed = values.some((entry) => !hashPattern.test(String(entry?.hash ?? entry?.transactionHash ?? entry))
        || (entry?.at !== undefined && !iso(entry.at))
        || (entry?.revision !== undefined && asNumber(entry.revision) === null));
      if (malformed) fail(`${name} assignment evidence`, 'assignment has invalid hash/timestamp/revision metadata');
      else if (hashes.length !== 1 || (expected && !same(hashes[0], expected))) fail(`${name} assignment evidence`, 'does not match independently derived identity');
      else pass(`${name} assignment evidence`, `${values.length} assignment observation(s)`);
    }
  }
  return { timeline, runtimeIds, firstId, secondId, stopAt, restartAt, finalSettlement, finalPayout };
}

async function publicRpcChecks(evidence, manifest) {
  if (process.env.VERIFY_EVIDENCE_SKIP_RPC === '1') {
    unknown('public RPC checks', 'explicitly skipped by VERIFY_EVIDENCE_SKIP_RPC=1');
    return;
  }
  const sourceUrl = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
  const destinationUrl = process.env.CREDITCOIN_RPC_URL ?? 'https://rpc.cc3-testnet.creditcoin.network';
  const timeout = Number(process.env.VERIFY_EVIDENCE_RPC_TIMEOUT_MS ?? 8000);
  const provider = (url, chainId) => {
    const request = new FetchRequest(url);
    request.timeout = timeout;
    return new JsonRpcProvider(request, chainId, { staticNetwork: true });
  };
  let source;
  let destination;
  try {
    source = provider(sourceUrl, 11155111);
    destination = provider(destinationUrl, 102031);
    await Promise.all([
      source.getNetwork().then((network) => Number(network.chainId) === 11155111 ? pass('source public chain ID', '11155111') : fail('source public chain ID', String(network.chainId))).catch((error) => unknown('source public chain ID', safeError(error))),
      destination.getNetwork().then((network) => Number(network.chainId) === 102031 ? pass('destination public chain ID', '102031') : fail('destination public chain ID', String(network.chainId))).catch((error) => unknown('destination public chain ID', safeError(error))),
    ]);
    const receipt = async (rpc, hash, name) => {
      if (!hashPattern.test(String(hash ?? ''))) { fail(`${name} receipt`, 'missing or invalid transaction hash'); return null; }
      try {
        const value = await rpc.getTransactionReceipt(hash);
        if (!value) { unknown(`${name} receipt`, 'receipt unavailable from public RPC'); return null; }
        const expectedStatus = name === 'replay' ? 0 : 1;
        if (Number(value.status) === expectedStatus) pass(`${name} receipt status`, `status=${value.status} block=${value.blockNumber}`);
        else fail(`${name} receipt status`, `expected=${expectedStatus} actual=${value.status}`);
        const recorded = name === 'source' ? evidence.source?.transaction : name === 'settlement' ? evidence.destination?.settlement : name === 'payout' ? evidence.destination?.payout : evidence.replay;
        if (txBlock(recorded) !== null && Number(txBlock(recorded)) !== Number(value.blockNumber)) fail(`${name} receipt block`, `evidence=${txBlock(recorded)} actual=${value.blockNumber}`);
        if (txStatus(recorded) !== null && Number(txStatus(recorded)) !== Number(value.status)) fail(`${name} recorded receipt status`, `evidence=${txStatus(recorded)} actual=${value.status}`);
        return value;
      } catch (error) { unknown(`${name} receipt`, safeError(error)); return null; }
    };
    const [sourceReceipt, settlementReceipt, payoutReceipt, replayReceipt] = await Promise.all([
      receipt(source, txHash(evidence.source?.transaction), 'source'),
      receipt(destination, txHash(evidence.destination?.settlement), 'settlement'),
      receipt(destination, txHash(evidence.destination?.payout), 'payout'),
      receipt(destination, txHash(evidence.replay), 'replay'),
    ]);
    const sourceRegistry = evidence.source?.registry;
    const destinationAsc = evidence.destination?.asc;
    const destinationVault = evidence.destination?.vault;
    let destinationInterfaces;
    try {
      destinationInterfaces = {
        asc: new Interface(readJson(path.join(root, 'artifacts', 'PrizeRailASC.json')).abi),
        vault: new Interface(readJson(path.join(root, 'artifacts', 'PrizeVault.json')).abi),
      };
    } catch (error) { fail('destination ABI loading', safeError(error)); }
    if (sourceReceipt) {
      if (same(sourceReceipt.to, sourceRegistry)) pass('source receipt target', sourceRegistry); else fail('source receipt target', `actual=${sourceReceipt.to} expected=${sourceRegistry}`);
      try {
        const iface = new Interface(readJson(path.join(root, 'artifacts', 'TournamentResultRegistry.json')).abi);
        const parsed = sourceReceipt.logs.map((log) => { try { return { address: log.address, event: iface.parseLog(log) }; } catch { return null; } }).find((item) => item?.event?.name === 'MatchFinalized' && same(item.address, sourceRegistry))?.event;
        if (!parsed) fail('source MatchFinalized event', 'event missing from source receipt');
        else {
          const expected = evidence.source?.decoded ?? {};
          for (const field of ['tournamentId', 'matchId', 'playerOne', 'playerTwo', 'winner', 'rulesHash', 'resultNonce', 'finalizationStatus', 'sourceChainId', 'finalizedAt', 'deadline']) {
            const actual = parsed.args[field]?.toString?.() ?? parsed.args[field];
            if (expected[field] === undefined) unknown(`source predicate ${field}`, 'field absent from evidence');
            else if (same(String(actual), String(expected[field])) || String(actual) === String(expected[field])) pass(`source predicate ${field}`, String(actual));
            else fail(`source predicate ${field}`, `actual=${actual} evidence=${expected[field]}`);
          }
          if (Number(evidence.attestation?.headerNumber) === Number(sourceReceipt.blockNumber)) pass('proof/source block binding', String(sourceReceipt.blockNumber));
          else fail('proof/source block binding', `proof=${evidence.attestation?.headerNumber} source=${sourceReceipt.blockNumber}`);
        }
      } catch (error) { fail('source event decoding', safeError(error)); }
    }
    if (settlementReceipt && destinationInterfaces) {
      if (same(settlementReceipt.to, destinationAsc)) pass('settlement receipt target', destinationAsc); else fail('settlement receipt target', `actual=${settlementReceipt.to}`);
      const resultVerified = settlementReceipt.logs.map((log) => { try { return { address: log.address, event: destinationInterfaces.asc.parseLog(log) }; } catch { return null; } }).find((item) => item?.event?.name === 'ResultVerified' && same(item.address, destinationAsc))?.event;
      const settled = settlementReceipt.logs.map((log) => { try { return { address: log.address, event: destinationInterfaces.vault.parseLog(log) }; } catch { return null; } }).find((item) => item?.event?.name === 'TournamentSettled' && same(item.address, destinationVault))?.event;
      if (!resultVerified) fail('ResultVerified event', 'event missing or wrong ASC address');
      if (!settled) fail('TournamentSettled event', 'event missing or wrong vault address');
      const decoded = evidence.source?.decoded ?? {};
      if (resultVerified && same(resultVerified.args.tournamentId, decoded.tournamentId) && same(resultVerified.args.winner, decoded.winner) && String(resultVerified.args.resultNonce) === String(decoded.resultNonce)) pass('ResultVerified business binding', 'tournament/winner/nonce match source');
      else if (resultVerified) fail('ResultVerified business binding', 'event does not match source predicates');
      if (resultVerified && decoded.tournamentId !== undefined && decoded.resultNonce !== undefined && evidence.source?.chainKey !== undefined && sourceRegistry) {
        try {
          const computed = keccak256(AbiCoder.defaultAbiCoder().encode(
            ['uint64', 'address', 'bytes32', 'uint256'],
            [evidence.source.chainKey, sourceRegistry, decoded.tournamentId, decoded.resultNonce],
          ));
          if (same(resultVerified.args.businessKey, computed)) pass('ResultVerified business-key binding', computed);
          else fail('ResultVerified business-key binding', `actual=${resultVerified.args.businessKey} expected=${computed}`);
        } catch (error) { fail('ResultVerified business-key binding', safeError(error)); }
      } else fail('ResultVerified business-key binding', 'source chain key or business fields missing');
      if (settled && same(settled.args.tournamentId, decoded.tournamentId) && same(settled.args.winner, decoded.winner) && String(settled.args.resultNonce) === String(decoded.resultNonce)) pass('TournamentSettled business binding', 'tournament/winner/nonce match source');
      else if (settled) fail('TournamentSettled business binding', 'event does not match source predicates');
      if (resultVerified && settled && same(resultVerified.args.sourceQueryKey, settled.args.sourceQueryKey)) pass('settlement query-key consistency', String(resultVerified.args.sourceQueryKey));
      else if (resultVerified && settled) fail('settlement query-key consistency', 'ResultVerified and TournamentSettled query keys differ');
      if (resultVerified) {
        const queryKey = String(resultVerified.args.sourceQueryKey ?? '');
        if (hashPattern.test(queryKey) && !/^0x0+$/i.test(queryKey)) pass('settlement query-key validity', queryKey);
        else fail('settlement query-key validity', 'sourceQueryKey is missing, malformed, or zero');
      }
    }
    if (payoutReceipt && destinationInterfaces) {
      if (same(payoutReceipt.to, destinationVault)) pass('payout receipt target', destinationVault); else fail('payout receipt target', `actual=${payoutReceipt.to}`);
      const claimed = payoutReceipt.logs.map((log) => { try { return { address: log.address, event: destinationInterfaces.vault.parseLog(log) }; } catch { return null; } }).find((item) => item?.event?.name === 'PrizeClaimed' && same(item.address, destinationVault))?.event;
      const decoded = evidence.source?.decoded ?? {};
      if (claimed && same(claimed.args.tournamentId, decoded.tournamentId) && same(claimed.args.winner, decoded.winner)) pass('PrizeClaimed business binding', `winner=${claimed.args.winner} amount=${claimed.args.amount}`);
      else fail('PrizeClaimed business binding', 'event missing or does not match source winner');
      if (claimed && evidence.destination?.amount !== undefined && String(claimed.args.amount) === String(evidence.destination.amount)) pass('payout amount binding', String(claimed.args.amount));
      else if (claimed) fail('payout amount binding', `event=${claimed.args.amount} evidence=${evidence.destination?.amount}`);
    }
    if (replayReceipt) {
      if (same(replayReceipt.to, destinationAsc)) pass('replay receipt target', destinationAsc); else fail('replay receipt target', `actual=${replayReceipt.to}`);
    }
    if (destinationVault && evidence.source?.decoded?.tournamentId) {
      try {
        const vault = new Contract(destinationVault, readJson(path.join(root, 'artifacts', 'PrizeVault.json')).abi, destination);
        const policy = await vault.policies(evidence.source.decoded.tournamentId);
        const expectedState = evidence.destination?.finalState ?? evidence.destination?.finalPolicyState;
        if (expectedState !== undefined && Number(policy.state) === Number(expectedState)) pass('final on-chain policy state', String(policy.state));
        else if (expectedState !== undefined) fail('final on-chain policy state', `actual=${policy.state} evidence=${expectedState}`);
        else unknown('final on-chain policy state', 'state absent from evidence');
        if (same(policy.winner, evidence.source.decoded.winner)) pass('final policy winner binding', policy.winner); else fail('final policy winner binding', String(policy.winner));
        if (same(policy.sourceRegistry, evidence.source.registry)) pass('final policy source registry binding', policy.sourceRegistry); else fail('final policy source registry binding', String(policy.sourceRegistry));
        if (evidence.source?.chainKey !== undefined && Number(policy.sourceChainKey) === Number(evidence.source.chainKey)) pass('final policy source chain key binding', String(policy.sourceChainKey));
        else if (evidence.source?.chainKey !== undefined) fail('final policy source chain key binding', `actual=${policy.sourceChainKey} evidence=${evidence.source.chainKey}`);
        if (evidence.source?.decoded?.rulesHash !== undefined && same(policy.rulesHash, evidence.source.decoded.rulesHash)) pass('final policy rules hash binding', String(policy.rulesHash));
        else if (evidence.source?.decoded?.rulesHash !== undefined) fail('final policy rules hash binding', `actual=${policy.rulesHash} evidence=${evidence.source.decoded.rulesHash}`);
        if (evidence.destination?.token !== undefined && same(policy.token, evidence.destination.token)) pass('final policy token binding', String(policy.token));
        else if (evidence.destination?.token !== undefined) fail('final policy token binding', `actual=${policy.token} evidence=${evidence.destination.token}`);
        if (evidence.source?.decoded?.resultNonce !== undefined && String(policy.resultNonce) === String(evidence.source.decoded.resultNonce)) pass('final policy nonce binding', String(policy.resultNonce));
        else if (evidence.source?.decoded?.resultNonce !== undefined) fail('final policy nonce binding', `actual=${policy.resultNonce} evidence=${evidence.source.decoded.resultNonce}`);
      } catch (error) { unknown('final on-chain policy state', safeError(error)); }
    }
  } finally {
    source?.destroy?.();
    destination?.destroy?.();
  }
}

async function verifyLiveWorkerV2() {
  const worker = evidence.worker ?? {};
  const jobId = worker.jobId;
  if (typeof jobId !== 'string' || !/^job-[A-Za-z0-9_-]{1,128}$/.test(jobId)) fail('worker job ID', 'invalid or missing job ID');
  else pass('worker job ID', jobId);
  if (evidence.dataMode !== 'LIVE') fail('live data mode', `expected LIVE, got ${evidence.dataMode}`);
  else pass('live data mode', 'LIVE');
  const manifest = loadManifest(evidence.deployment?.selector ?? evidence.deployment?.manifest);
  if (manifest) {
    if (Number(manifest.value.source?.chainId) === 11155111 && Number(manifest.value.destination?.chainId) === 102031) pass('deployment network binding', 'Sepolia=11155111 CC3=102031');
    else fail('deployment network binding', 'manifest network IDs do not match milestone');
    const expectedAddresses = {
      registry: manifest.value.source?.contract,
      token: manifest.value.destination?.token?.address,
      vault: manifest.value.destination?.vault?.address,
      asc: manifest.value.destination?.asc?.address,
    };
    for (const [field, expected] of Object.entries(expectedAddresses)) {
      const actual = field === 'registry' ? evidence.source?.registry : evidence.destination?.[field];
      if (!expected || !actual) fail(`deployment ${field} binding`, 'address missing from manifest or evidence');
      else if (same(actual, expected)) pass(`deployment ${field} binding`, String(actual));
      else fail(`deployment ${field} binding`, `actual=${actual} manifest=${expected}`);
    }
  }
  const source = evidence.source ?? {};
  const destination = evidence.destination ?? {};
  // Accept the explicit v2 names as well as the compact names used by the
  // earlier recorder, while keeping all checks on the normalized values.
  if (!source.transaction && source.tx) source.transaction = source.tx;
  if (!destination.settlement && destination.settlementTx) destination.settlement = destination.settlementTx;
  if (!destination.payout && destination.payoutTx) destination.payout = destination.payoutTx;
  if (Number(source.chainId) === 11155111) pass('recorded source chain', '11155111'); else fail('recorded source chain', String(source.chainId));
  if (Number(destination.chainId) === 102031) pass('recorded destination chain', '102031'); else fail('recorded destination chain', String(destination.chainId));
  if (same(source.eventSignature ?? source.transaction?.eventSignature ?? worker.sourceEventSignature, canonicalEventSignature)) pass('canonical source event signature', canonicalEventSignature);
  else fail('canonical source event signature', `expected=${canonicalEventSignature}`);
  if (!hashPattern.test(String(txHash(source.transaction) ?? ''))) fail('source transaction identity', 'missing/invalid source hash');
  else pass('source transaction identity', txHash(source.transaction));
  if (!hashPattern.test(String(txHash(destination.settlement) ?? ''))) fail('settlement transaction identity', 'missing/invalid settlement hash');
  if (!hashPattern.test(String(txHash(destination.payout) ?? ''))) fail('payout transaction identity', 'missing/invalid payout hash');
  if (evidence.attestation?.nativePreflight === true || evidence.attestation?.verified === true) pass('proof preflight outcome', 'PASS');
  else fail('proof preflight outcome', 'fresh artifact does not record a successful proof preflight');
  const decoded = source.decoded ?? {};
  for (const field of ['tournamentId', 'matchId', 'rulesHash']) {
    if (hashPattern.test(String(decoded[field] ?? ''))) pass(`source decoded ${field}`, String(decoded[field]));
    else fail(`source decoded ${field}`, `missing or invalid ${field}`);
  }
  for (const field of ['playerOne', 'playerTwo', 'winner']) {
    if (/^0x[0-9a-f]{40}$/i.test(String(decoded[field] ?? ''))) pass(`source decoded ${field}`, String(decoded[field]));
    else fail(`source decoded ${field}`, `missing or invalid ${field}`);
  }
  if (decoded.resultNonce !== undefined && /^\d+$/.test(String(decoded.resultNonce))) pass('source decoded result nonce', String(decoded.resultNonce));
  else fail('source decoded result nonce', 'missing or invalid resultNonce');
  if (decoded.result !== undefined && Number.isInteger(Number(decoded.result)) && Number(decoded.result) >= 0 && Number(decoded.result) <= 4) pass('source decoded result enum', String(decoded.result));
  else fail('source decoded result enum', 'missing or invalid result');
  if (decoded.winner && decoded.playerOne && decoded.playerTwo && Number(decoded.result) !== 0) {
    const expectedWinner = [1, 3].includes(Number(decoded.result)) ? String(decoded.playerOne).toLowerCase() : String(decoded.playerTwo).toLowerCase();
    if (String(decoded.winner).toLowerCase() === expectedWinner) pass('source winner/result binding', 'winner follows result predicate');
    else fail('source winner/result binding', `winner=${decoded.winner} expected=${expectedWinner}`);
  }
  if (!evidence.replay && evidence.destination?.replay) evidence.replay = evidence.destination.replay;
  if (evidence.replay?.rejected === true && Number(evidence.replay?.status) === 0) pass('replay outcome claim', 'recorded status-0 rejection');
  else fail('replay outcome claim', 'replay is not recorded as a mined status-0 rejection');
  const dataDirectory = worker.dataDirectory ?? worker.storePath;
  const dataPath = relativeRepoPath(dataDirectory, 'durable state');
  let journalData = parseEmbeddedJournal(worker.journalRecords ?? worker.journal ?? evidence.journal, jobId);
  const hasEmbeddedJournal = journalData.records.length > 0;
  if (!hasEmbeddedJournal) journalData = { records: [], jobs: [], heartbeats: [], transitions: [], unavailable: 'not specified' };
  if (dataPath) {
    const journalPath = path.join(dataPath, worker.journalFile ?? 'worker.journal');
    const diskJournal = parseJournal(journalPath, jobId);
    if (hasEmbeddedJournal) {
      // Embedded records are the portable witness. If the original ignored
      // journal is present, compare every embedded line. A live worker may
      // append heartbeat records after the evidence snapshot was captured, so
      // an exact count is not required when the embedded prefix is identical.
      if (!diskJournal.unavailable) {
        let consistent = true;
        for (const embeddedRecord of journalData.records) {
          const diskRecord = diskJournal.records.find((candidate) => candidate.line === embeddedRecord.line);
          if (!diskRecord || JSON.stringify(diskRecord.record) !== JSON.stringify(embeddedRecord.record)) { consistent = false; break; }
        }
        if (!consistent || diskJournal.records.length < journalData.records.length) fail('embedded/disk journal consistency', `embedded=${journalData.records.length} disk=${diskJournal.records.length}`);
        else if (diskJournal.records.length > journalData.records.length) pass('embedded/disk journal consistency', `embedded snapshot matches; ${diskJournal.records.length - journalData.records.length} later record(s) ignored`);
        else pass('embedded/disk journal consistency', `${journalData.records.length} records match`);
      }
      pass('durable journal availability', 'portable embedded journal records');
      if (journalData.malformed) fail('durable journal syntax', 'embedded complete malformed record(s) found');
      else pass('durable journal syntax', `${journalData.records.length} embedded records parsed`);
    } else {
      journalData = diskJournal;
      if (journalData.unavailable) unknown('durable journal availability', journalData.unavailable);
      else {
        // A disk-only journal cannot be independently reproduced from a fresh
        // checkout; retain it as local corroboration but fail the portability
        // requirement below.
        unknown('durable journal portability', 'raw journal is not embedded in the checked-in evidence bundle');
        pass('durable journal availability', path.relative(root, journalPath));
        if (journalData.malformed) fail('durable journal syntax', 'complete malformed record(s) found');
        else if (journalData.trailingPartial) unknown('durable journal syntax', 'trailing partial record was not independently recoverable');
        else pass('durable journal syntax', `${journalData.records.length} records parsed`);
      }
    }
    if (journalData.jobs.length && journalData.jobs.some((row) => row.jobId !== jobId)) fail('durable journal job identity', 'journal target mismatch');
  } else if (!hasEmbeddedJournal) {
    fail('durable journal evidence', 'no embedded journal and no valid durable-state path');
  }
  if (!hasEmbeddedJournal) fail('durable journal portability', 'fresh evidence must embed the sanitized journal records; ignored .data alone is not reproducible');
  else if (!journalData.jobs.length) fail('durable journal portability', 'embedded journal contains no target-job snapshots');
  checkRuntimesAndTimeline(evidence, journalData);
  const expectedSourceIdentity = `${source.chainId}:${String(txHash(source.transaction) ?? '').toLowerCase()}`;
  const expectedBusinessIdentity = decoded.tournamentId && decoded.resultNonce !== undefined
    ? `${String(decoded.tournamentId).toLowerCase()}:${String(decoded.resultNonce)}`
    : null;
  const recordedSourceIdentity = worker.idempotency?.sourceIdentity ?? worker.sourceIdentity;
  const recordedBusinessIdentity = worker.idempotency?.businessIdentity ?? worker.businessIdentity;
  if (recordedSourceIdentity && recordedSourceIdentity.toLowerCase() === expectedSourceIdentity) pass('source identity binding', recordedSourceIdentity);
  else fail('source identity binding', `recorded=${recordedSourceIdentity ?? 'missing'} expected=${expectedSourceIdentity}`);
  if (expectedBusinessIdentity && recordedBusinessIdentity && recordedBusinessIdentity.toLowerCase() === expectedBusinessIdentity) pass('business identity binding', recordedBusinessIdentity);
  else if (expectedBusinessIdentity) fail('business identity binding', `recorded=${recordedBusinessIdentity ?? 'missing'} expected=${expectedBusinessIdentity}`);
  checkHttpEvidence(evidence, jobId);
  checkSourceHashes(evidence.sourceHashes ?? evidence.sourceVersion);
  if (worker.finalState === 'CLAIMED' || worker.final?.productState === 'CLAIMED' || evidence.apiFinal?.productState === 'CLAIMED') pass('final worker/API state claim', 'CLAIMED recorded');
  else fail('final worker/API state claim', 'fresh worker did not record CLAIMED');
  if (evidence.outcome === 'PASS') pass('recorded evidence outcome', 'PASS');
  else fail('recorded evidence outcome', `expected PASS, got ${evidence.outcome}`);
  await publicRpcChecks(evidence, manifest);
}

function verifyLegacyLive() {
  // Historical v1 artifacts remain parseable for provenance, but are not
  // accepted as closure proof because their restart/hash claims are assertions.
  fail('fresh closure schema', 'legacy live-worker evidence lacks independently reconstructable restart/hash/API/source-version fields');
  if (evidence.worker?.restart?.demonstrated === true) unknown('legacy restart assertion', 'self-reported restart.demonstrated is not trusted');
  if (evidence.worker?.idempotency) unknown('legacy idempotency assertion', 'aggregate counts are not trusted without hash history');
  if (evidence.outcome === 'PASS') unknown('legacy recorded outcome', 'historical PASS is retained as provenance, not closure evidence');
}

function verifyLegacyProtocol() {
  const required = [
    ['chain ID', Number(evidence.chainId) === 11155111],
    ['tournament ID', hashPattern.test(String(evidence.tournamentId ?? ''))],
    ['rules hash', hashPattern.test(String(evidence.rulesHash ?? ''))],
    ['source hash', Boolean(evidence.source?.hash)],
    ['settlement hash', Boolean(evidence.settlement?.hash)],
    ['payout hash', Boolean(evidence.payout?.hash)],
    ['source replay rejection', evidence.replay?.rejected === true],
    ['business replay rejection', evidence.businessReplay?.rejected === true],
  ];
  for (const [name, okay] of required) okay ? pass(name, 'recorded') : fail(name, 'missing or contradictory');
  for (const key of ['wrongChain', 'wrongSource', 'wrongEvent', 'wrongTournament', 'wrongRules', 'wrongWinner', 'wrongNonce', 'invalidFinalization', 'unfunded', 'unauthorizedSettlement', 'doublePayout', 'alreadyFinalized', 'invalidReveal', 'expired', 'unauthorizedRefund', 'invalidProof']) {
    if (evidence[key]?.rejected === true) pass(`negative case ${key}`, 'rejected');
    else fail(`negative case ${key}`, 'missing rejection');
  }
}

const isLiveWorker = evidence.mode === 'live-worker' || evidence.mode === 'live-worker-v2';
const isV2 = isLiveWorker && (Number(evidence.schemaVersion) >= 2 || evidence.mode === 'live-worker-v2' || evidence.worker?.timeline || evidence.sourceHashes);
if (isV2) await verifyLiveWorkerV2();
else if (isLiveWorker) verifyLegacyLive();
else if (evidence.mode === 'live-attestcoin') {
  if (Number(evidence.source?.chainId) === 11155111) pass('source chain ID', '11155111'); else fail('source chain ID', String(evidence.source?.chainId));
  if (Number(evidence.destination?.chainId) === 102031) pass('destination chain ID', '102031'); else fail('destination chain ID', String(evidence.destination?.chainId));
  if (evidence.attestation?.verified === true) pass('attestation preflight', 'verified'); else fail('attestation preflight', 'not verified');
  if (evidence.replay?.rejected === true) pass('replay rejection', 'recorded'); else fail('replay rejection', 'missing');
  unknown('restart evidence', 'live-attestcoin artifact is not a worker restart run');
} else verifyLegacyProtocol();

const overall = checks.some((item) => item.status === 'FAIL') ? 'FAIL' : checks.some((item) => item.status === 'UNKNOWN') ? 'UNKNOWN' : 'PASS';
console.log(JSON.stringify({ file, verified: overall === 'PASS', mode: evidence.mode, runId: evidence.runId, checks, overall }, null, 2));
process.exit(overall === 'FAIL' ? 1 : 0);
