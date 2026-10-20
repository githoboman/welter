import {
  BrowserProvider,
  Contract,
  Interface,
  ZeroAddress,
  isAddress,
  parseUnits,
} from 'ethers';
import { PUBLIC_CONFIG } from './config.js';
import type { WalletSnapshot } from './domain.js';
import type { Eip1193Provider } from './wallet.js';

export type LaunchStep = 'PRECHECK' | 'CREATE' | 'APPROVE' | 'FUND' | 'COMPLETE';
export type LaunchPhase = 'IDLE' | 'READING' | 'SIGNING' | 'AWAITING_RECEIPT' | 'SUCCESS' | 'FAIL' | 'UNKNOWN';

export interface LaunchDraft {
  tournamentId: string;
  amount: string;
  settlementDeadline: string;
  refundDeadline: string;
}

export interface LaunchReceiptEvidence {
  hash: string;
  status: number | null;
  blockNumber: number | null;
  gasUsed: string | null;
}

export interface LaunchState {
  phase: LaunchPhase;
  step: LaunchStep;
  message: string;
  transaction?: LaunchReceiptEvidence;
  balance?: string;
  allowance?: string;
  decimals?: number;
}

export const initialLaunchState: LaunchState = {
  phase: 'IDLE',
  step: 'PRECHECK',
  message: 'No transaction has been requested.',
};

const VAULT_ABI = [
  'function createTournament(bytes32 tournamentId,address organizer,uint64 sourceChainKey,address sourceRegistry,bytes32 rulesHash,address token,uint256 amount,uint64 settlementDeadline,uint64 refundDeadline)',
  'function fund(bytes32 tournamentId)',
  'function policies(bytes32) view returns (address organizer,uint64 sourceChainKey,address sourceRegistry,bytes32 rulesHash,address token,uint256 amount,uint64 settlementDeadline,uint64 refundDeadline,address winner,uint256 resultNonce,bytes32 sourceQueryKey,uint8 state)',
  'event TournamentCreated(bytes32 indexed tournamentId,address indexed organizer,address sourceRegistry,bytes32 rulesHash,uint256 amount)',
  'event TournamentFunded(bytes32 indexed tournamentId,uint256 amount)',
] as const;

const TOKEN_ABI = [
  'function allowance(address owner,address spender) view returns (uint256)',
  'function approve(address spender,uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const;

const vaultInterface = new Interface(VAULT_ABI);

function validBytes32(value: string): boolean { return /^0x[0-9a-f]{64}$/i.test(value); }

function uint64(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a positive Unix timestamp`);
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > 18446744073709551615n) throw new Error(`${label} is outside the uint64 range`);
  return parsed;
}

function safeError(error: unknown): string {
  const candidate = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {};
  const code = typeof candidate.code === 'string' || typeof candidate.code === 'number' ? String(candidate.code) : 'UNKNOWN';
  const raw = typeof candidate.message === 'string' ? candidate.message : 'The wallet or RPC request could not be completed.';
  const message = raw
    .replace(/(?:[a-z][a-z0-9+.-]*):\/\/[^\s]+/gi, '[url-redacted]')
    .replace(/(?:PRIVATE_KEY|SESSION_SECRET|DATABASE_URL|API_KEY|TOKEN)=?[^\s,;]*/gi, '[secret-redacted]')
    .slice(0, 240);
  return `${code}: ${message}`;
}

function isWalletRejection(error: unknown): boolean {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return String(code) === '4001';
}

function policyTuple(raw: any): { organizer: string; state: number; amount: bigint } {
  return {
    organizer: String(raw.organizer ?? raw[0] ?? ZeroAddress),
    state: Number(raw.state ?? raw[11] ?? 0),
    amount: BigInt(String(raw.amount ?? raw[5] ?? 0)),
  };
}

function receiptEvidence(receipt: any, hash: string): LaunchReceiptEvidence {
  return {
    hash: String(hash).toLowerCase(),
    status: receipt ? Number(receipt.status) : null,
    blockNumber: receipt?.blockNumber === undefined ? null : Number(receipt.blockNumber),
    gasUsed: receipt?.gasUsed === undefined ? null : String(receipt.gasUsed),
  };
}

function hasEvent(receipt: any, name: string, tournamentId: string): boolean {
  for (const log of receipt?.logs ?? []) {
    try {
      if (String(log.address).toLowerCase() !== PUBLIC_CONFIG.prizeVault.toLowerCase()) continue;
      const parsed = vaultInterface.parseLog({ topics: log.topics, data: log.data });
      if (parsed?.name === name && String(parsed.args?.[0]).toLowerCase() === tournamentId.toLowerCase()) return true;
    } catch {
      // Unrelated logs are expected; the caller handles a missing required event.
    }
  }
  return false;
}

async function waitForReceipt(provider: BrowserProvider, hash: string, timeoutMs = 60_000): Promise<any | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const receipt = await provider.getTransactionReceipt(hash);
      if (receipt) return receipt;
    } catch {
      // A transient receipt read is still UNKNOWN; retry within the bounded window.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
  }
  return null;
}

function updateState(onUpdate: (state: LaunchState) => void, state: LaunchState): void {
  onUpdate(state);
}

async function sendAndObserve(
  provider: BrowserProvider,
  operation: () => Promise<any>,
  step: Exclude<LaunchStep, 'PRECHECK' | 'COMPLETE'>,
  onUpdate: (state: LaunchState) => void,
): Promise<{ kind: 'SUCCESS' | 'FAIL' | 'UNKNOWN'; transaction?: LaunchReceiptEvidence; message?: string }> {
  updateState(onUpdate, { phase: 'SIGNING', step, message: `Confirm the ${step.toLowerCase()} transaction in your wallet.` });
  let transaction: any;
  try {
    transaction = await operation();
  } catch (error) {
    return { kind: 'FAIL', message: isWalletRejection(error) ? 'The wallet request was rejected.' : safeError(error) };
  }
  const hash = String(transaction?.hash ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) return { kind: 'UNKNOWN', message: 'The wallet did not return a valid transaction hash.' };
  updateState(onUpdate, { phase: 'AWAITING_RECEIPT', step, message: `Transaction ${hash} was submitted. Waiting for a mined receipt.`, transaction: { hash, status: null, blockNumber: null, gasUsed: null } });
  const receipt = await waitForReceipt(provider, hash);
  if (!receipt) return { kind: 'UNKNOWN', transaction: { hash, status: null, blockNumber: null, gasUsed: null }, message: `No receipt was observed for ${hash} within 60 seconds. Check the explorer and policy state before retrying; no automatic retry was sent.` };
  const evidence = receiptEvidence(receipt, hash);
  if (evidence.status !== 1) return { kind: 'FAIL', transaction: evidence, message: `The ${step.toLowerCase()} transaction was mined with status ${evidence.status ?? 'UNKNOWN'}.` };
  return { kind: 'SUCCESS', transaction: evidence };
}

export async function launchPrizePolicy(
  wallet: WalletSnapshot,
  provider: Eip1193Provider | undefined,
  draft: LaunchDraft,
  onUpdate: (state: LaunchState) => void,
): Promise<LaunchState> {
  const fail = (message: string): LaunchState => {
    const state = { phase: 'FAIL' as const, step: 'PRECHECK' as const, message };
    updateState(onUpdate, state);
    return state;
  };
  const unknown = (message: string): LaunchState => {
    const state = { phase: 'UNKNOWN' as const, step: 'PRECHECK' as const, message };
    updateState(onUpdate, state);
    return state;
  };

  if (!provider) return fail('No EIP-1193 wallet is available. Install or unlock a browser wallet first.');
  if (wallet.status !== 'CONNECTED' || !wallet.address || (wallet.network !== 'BOT_CHAIN_TESTNET' && wallet.network !== 'BOT_CHAIN_MAINNET')) return fail('Connect a wallet and switch it to BOT Chain Testnet before launching a policy.');
  if (!validBytes32(draft.tournamentId.trim())) return fail('Tournament ID must be 0x followed by 64 hexadecimal characters.');
  if (!isAddress(wallet.address)) return fail('The connected wallet address is malformed.');
  if (!isAddress(PUBLIC_CONFIG.prizeVault) || !isAddress(PUBLIC_CONFIG.prizeToken) || !isAddress(PUBLIC_CONFIG.sourceRegistry) || !validBytes32(PUBLIC_CONFIG.sourceRulesHash)) return unknown('The checked-in public deployment configuration is malformed.');

  let settlementDeadline: bigint;
  let refundDeadline: bigint;
  try {
    settlementDeadline = uint64(draft.settlementDeadline.trim(), 'Settlement deadline');
    refundDeadline = uint64(draft.refundDeadline.trim(), 'Refund deadline');
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Deadline validation failed.');
  }
  if (refundDeadline <= settlementDeadline) return fail('Refund deadline must be later than the settlement deadline.');

  updateState(onUpdate, { phase: 'READING', step: 'PRECHECK', message: 'Reading BOT Chain network, policy, token decimals, balance, and allowance.' });
  try {
    const browserProvider = new BrowserProvider(provider as any);
    const network = await browserProvider.getNetwork();
    if (network.chainId !== BigInt(PUBLIC_CONFIG.botchainChainId) && network.chainId !== BigInt(PUBLIC_CONFIG.botchainMainnetChainId)) return fail(`Wallet is on chain ${network.chainId.toString()}, not BOT Chain Testnet (${PUBLIC_CONFIG.botchainChainId}).`);
    const latest = await browserProvider.getBlock('latest');
    if (!latest) return unknown('The latest BOT Chain block could not be read; deadlines are UNKNOWN.');
    const now = BigInt(String(latest.timestamp));
    if (settlementDeadline <= now) return fail('Settlement deadline must be in the future according to the current BOT Chain block.');

    const signer = await browserProvider.getSigner(wallet.address);
    const vaultRead = new Contract(PUBLIC_CONFIG.prizeVault, VAULT_ABI, browserProvider) as any;
    const tokenRead = new Contract(PUBLIC_CONFIG.prizeToken, TOKEN_ABI, browserProvider) as any;
    const existing = policyTuple(await vaultRead.policies(draft.tournamentId.trim()));
    if (existing.organizer.toLowerCase() !== ZeroAddress.toLowerCase()) return fail('This tournament ID already has a policy. Choose an unused ID; retrying create would be a duplicate.');
    const decimals = Number(await tokenRead.decimals());
    if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) return unknown('The configured token returned unusable decimals.');
    let amount: bigint;
    try { amount = parseUnits(draft.amount.trim(), decimals); } catch { return fail('Amount must be a positive decimal token amount.'); }
    if (amount <= 0n) return fail('Amount must be greater than zero.');
    const balance = BigInt(String(await tokenRead.balanceOf(wallet.address)));
    if (balance < amount) return fail(`Insufficient PRIZE test-token balance. Chain read: ${balance.toString()} base units; required ${amount.toString()}. This flow does not mint tokens.`);
    const allowance = BigInt(String(await tokenRead.allowance(wallet.address, PUBLIC_CONFIG.prizeVault)));
    const common = { balance: balance.toString(), allowance: allowance.toString(), decimals };
    updateState(onUpdate, { phase: 'READING', step: 'PRECHECK', message: `Preconditions passed. ${draft.amount.trim()} PRIZE will be reserved to the immutable organizer ${wallet.address.toLowerCase()}.`, ...common });

    const vault = new Contract(PUBLIC_CONFIG.prizeVault, VAULT_ABI, signer) as any;
    const token = new Contract(PUBLIC_CONFIG.prizeToken, TOKEN_ABI, signer) as any;
    const create = await sendAndObserve(
      browserProvider,
      () => vault.createTournament(
        draft.tournamentId.trim(),
        wallet.address,
        PUBLIC_CONFIG.attestcoinChainKey,
        PUBLIC_CONFIG.sourceRegistry,
        PUBLIC_CONFIG.sourceRulesHash,
        PUBLIC_CONFIG.prizeToken,
        amount,
        settlementDeadline,
        refundDeadline,
      ),
      'CREATE',
      onUpdate,
    );
    if (create.kind !== 'SUCCESS') {
      const state = { phase: create.kind, step: 'CREATE' as const, message: create.message ?? 'Policy creation did not complete.', transaction: create.transaction, ...common };
      updateState(onUpdate, state);
      return state;
    }
    const created = policyTuple(await vaultRead.policies(draft.tournamentId.trim()));
    if (created.organizer.toLowerCase() !== wallet.address.toLowerCase() || created.state !== 0 || created.amount !== amount || !hasEvent((await browserProvider.getTransactionReceipt(create.transaction!.hash)), 'TournamentCreated', draft.tournamentId.trim())) return unknown('Create receipt succeeded but the expected TournamentCreated event or DRAFT policy read was not confirmed. Do not resubmit until the chain state is reconciled.');

    let currentAllowance = allowance;
    if (currentAllowance < amount) {
      const approval = await sendAndObserve(browserProvider, () => token.approve(PUBLIC_CONFIG.prizeVault, amount), 'APPROVE', onUpdate);
      if (approval.kind !== 'SUCCESS') {
        const state = { phase: approval.kind, step: 'APPROVE' as const, message: approval.message ?? 'Token approval did not complete.', transaction: approval.transaction, ...common };
        updateState(onUpdate, state);
        return state;
      }
      currentAllowance = BigInt(String(await tokenRead.allowance(wallet.address, PUBLIC_CONFIG.prizeVault)));
      if (currentAllowance < amount) return unknown('Approval receipt succeeded but the allowance read is still below the reserve. Reconcile before retrying fund.');
    } else {
      updateState(onUpdate, { phase: 'READING', step: 'APPROVE', message: 'Existing allowance already covers the exact reserve; no approval transaction was needed.', ...common, allowance: currentAllowance.toString() });
    }

    const funding = await sendAndObserve(browserProvider, () => vault.fund(draft.tournamentId.trim()), 'FUND', onUpdate);
    if (funding.kind !== 'SUCCESS') {
      const state = { phase: funding.kind, step: 'FUND' as const, message: funding.message ?? 'Funding did not complete.', transaction: funding.transaction, ...common, allowance: currentAllowance.toString() };
      updateState(onUpdate, state);
      return state;
    }
    const funded = policyTuple(await vaultRead.policies(draft.tournamentId.trim()));
    if (funded.state !== 1 || funded.organizer.toLowerCase() !== wallet.address.toLowerCase() || funded.amount !== amount || !hasEvent((await browserProvider.getTransactionReceipt(funding.transaction!.hash)), 'TournamentFunded', draft.tournamentId.trim())) return unknown('Funding receipt succeeded but the expected TournamentFunded event or FUNDED policy read was not confirmed. Do not resubmit until the chain state is reconciled.');
    const state: LaunchState = { phase: 'SUCCESS', step: 'COMPLETE', message: 'Policy created and funded. The reserve is held by PrizeVault; no source match or payout has been created by this action.', transaction: funding.transaction, ...common, allowance: currentAllowance.toString() };
    updateState(onUpdate, state);
    return state;
  } catch (error) {
    if (isWalletRejection(error)) return fail('The wallet request was rejected. No successful policy transition was observed.');
    return unknown(`A CC3 read or wallet request is unavailable: ${safeError(error)} Check receipts and policy state before retrying.`);
  }
}
