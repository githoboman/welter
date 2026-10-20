import type {
  ApiHealthResponse,
  DataResult,
  DeploymentConfig,
  HistoricalRunEvidence,
  LiveResponse,
  PrizeRailRepository,
  RecoveryEvidence,
} from './domain.js';
import { PUBLIC_CONFIG } from './config.js';

const HISTORICAL_RUN_URL = '/evidence/live-2026-09-10T02-44-30-530Z.json';
const RECOVERY_URL = '/evidence/recovery-f620cf7d.json';
const DEPLOYMENT_URL = '/evidence/botchain-deployment-2026-10-20T14-50-43-758Z.json';
const LIVE_API_BASE_URL = PUBLIC_CONFIG.apiBaseUrl;

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Evidence request returned ${response.status}`);
  return (await response.json()) as T;
}

interface ApiLoad<T> {
  status: number;
  body: T;
}

async function loadApiJson<T>(url: string): Promise<ApiLoad<T>> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  let body: T;
  try {
    body = (await response.json()) as T;
  } catch {
    throw new Error(`API returned a non-JSON response (${response.status})`);
  }
  return { status: response.status, body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOutcome(value: unknown): value is 'PASS' | 'FAIL' | 'UNKNOWN' {
  return value === 'PASS' || value === 'FAIL' || value === 'UNKNOWN';
}

function isLiveResponse(value: unknown): value is LiveResponse {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 1
    && value.dataMode === 'LIVE'
    && isOutcome(value.outcome)
    && typeof value.productState === 'string'
    && (value.policyState === null || typeof value.policyState === 'string')
    && (value.jobState === null || typeof value.jobState === 'string')
    && (value.source === null || isRecord(value.source))
    && isRecord(value.attestcoin)
    && isRecord(value.settlement)
    && isRecord(value.payout)
    && (value.replay === null || isRecord(value.replay))
    && (value.refundRecovery === null || isRecord(value.refundRecovery))
    && Array.isArray(value.evidenceReferences)
    && isRecord(value.explorerLinks)
    && isRecord(value.timestamps)
    && isRecord(value.retry)
    && (value.error === null || isRecord(value.error));
}

function isApiHealthResponse(value: unknown): value is ApiHealthResponse {
  return isRecord(value)
    && value.schemaVersion === 1
    && value.dataMode === 'LIVE'
    && isOutcome(value.outcome);
}

function apiUrl(pathname: string): string {
  return `${LIVE_API_BASE_URL.replace(/\/$/, '')}/${pathname.replace(/^\//, '')}`;
}

function validTournamentId(value: string): boolean {
  return /^0x[0-9a-f]{64}$/i.test(value);
}

function unknown<T>(source: string, message: string): DataResult<T> {
  return { mode: 'HISTORICAL_VERIFIED_RUN', outcome: 'UNKNOWN', source, message };
}

function safeMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  return raw
    .replace(/(?:[a-z][a-z0-9+.-]*):\/\/[^\s]+/gi, '[url-redacted]')
    .replace(/(?:PRIVATE_KEY|SESSION_SECRET|DATABASE_URL|API_KEY|TOKEN)=?[^\s,;]*/gi, '[secret-redacted]')
    .slice(0, 240);
}

export const repository: PrizeRailRepository = {
  async getHistoricalRun(): Promise<DataResult<HistoricalRunEvidence>> {
    try {
      const data = await loadJson<HistoricalRunEvidence>(HISTORICAL_RUN_URL);
      if (!data.runId || !data.source?.transaction?.hash || !data.destination?.settlement?.hash) {
        return unknown(HISTORICAL_RUN_URL, 'The historical bundle is missing required transaction evidence.');
      }
      return { mode: 'HISTORICAL_VERIFIED_RUN', outcome: 'PASS', data, source: HISTORICAL_RUN_URL };
    } catch (error) {
      return unknown(HISTORICAL_RUN_URL, safeMessage(error, 'Historical evidence unavailable.'));
    }
  },

  async getRecoveryEvidence(): Promise<DataResult<RecoveryEvidence>> {
    try {
      const data = await loadJson<RecoveryEvidence>(RECOVERY_URL);
      if (!data.tournamentId || !data.recovery?.hash) {
        return unknown(RECOVERY_URL, 'The recovery bundle is missing required transaction evidence.');
      }
      return { mode: 'HISTORICAL_VERIFIED_RUN', outcome: 'PASS', data, source: RECOVERY_URL };
    } catch (error) {
      return unknown(RECOVERY_URL, safeMessage(error, 'Recovery evidence unavailable.'));
    }
  },

  async getDeployment(): Promise<DataResult<DeploymentConfig>> {
    try {
      const data = await loadJson<DeploymentConfig>(DEPLOYMENT_URL);
      if (!data.source?.contract || !data.destination?.vault?.address) {
        return { mode: 'LIVE', outcome: 'UNKNOWN', source: DEPLOYMENT_URL, message: 'Deployment manifest is incomplete.' };
      }
      return { mode: 'LIVE', outcome: 'PASS', data, source: DEPLOYMENT_URL };
    } catch (error) {
      return {
        mode: 'LIVE',
        outcome: 'UNKNOWN',
        source: DEPLOYMENT_URL,
        message: safeMessage(error, 'Deployment manifest unavailable.'),
      };
    }
  },

  async getLiveEvidence(tournamentId: string): Promise<DataResult<LiveResponse>> {
    const normalized = tournamentId.trim().toLowerCase();
    const source = apiUrl(`tournaments/${encodeURIComponent(normalized)}/evidence`);
    if (!validTournamentId(normalized)) {
      return { mode: 'LIVE', outcome: 'UNKNOWN', source, message: 'Tournament ID must be 0x followed by 64 hexadecimal characters.' };
    }
    try {
      const response = await loadApiJson<unknown>(source);
      if (!isLiveResponse(response.body)) {
        return { mode: 'LIVE', outcome: 'UNKNOWN', source, message: `Live API returned an invalid response (${response.status}).` };
      }
      return {
        mode: 'LIVE',
        outcome: response.body.outcome,
        data: response.body,
        source,
        message: response.body.error && typeof response.body.error.message === 'string' ? response.body.error.message : undefined,
      };
    } catch (error) {
      return { mode: 'LIVE', outcome: 'UNKNOWN', source, message: safeMessage(error, 'Live API is unavailable. Start the local API or configure a hosted /api/v1 endpoint.') };
    }
  },

  async getLiveStatus(tournamentId: string): Promise<DataResult<LiveResponse>> {
    const normalized = tournamentId.trim().toLowerCase();
    const source = apiUrl(`tournaments/${encodeURIComponent(normalized)}/status`);
    if (!validTournamentId(normalized)) {
      return { mode: 'LIVE', outcome: 'UNKNOWN', source, message: 'Tournament ID must be 0x followed by 64 hexadecimal characters.' };
    }
    try {
      const response = await loadApiJson<unknown>(source);
      if (!isLiveResponse(response.body)) {
        return { mode: 'LIVE', outcome: 'UNKNOWN', source, message: `Live API returned an invalid response (${response.status}).` };
      }
      return { mode: 'LIVE', outcome: response.body.outcome, data: response.body, source };
    } catch (error) {
      return { mode: 'LIVE', outcome: 'UNKNOWN', source, message: safeMessage(error, 'Live API is unavailable.') };
    }
  },

  async getApiHealth(): Promise<DataResult<ApiHealthResponse>> {
    const source = apiUrl('health');
    try {
      const response = await loadApiJson<unknown>(source);
      if (!isApiHealthResponse(response.body)) {
        return { mode: 'LIVE', outcome: 'UNKNOWN', source, message: `Live API health returned an invalid response (${response.status}).` };
      }
      return { mode: 'LIVE', outcome: response.body.outcome, data: response.body, source };
    } catch (error) {
      return { mode: 'LIVE', outcome: 'UNKNOWN', source, message: safeMessage(error, 'Live API health is unavailable.') };
    }
  },
};

export { HISTORICAL_RUN_URL, RECOVERY_URL, DEPLOYMENT_URL, LIVE_API_BASE_URL };
