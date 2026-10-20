import { PUBLIC_CONFIG } from './config.js';
import type { WalletNetwork, WalletSnapshot } from './domain.js';

export interface Eip1193Request {
  method: string;
  params?: readonly unknown[];
}

export interface Eip1193Provider {
  request(args: Eip1193Request): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

interface WalletErrorLike {
  code?: unknown;
  message?: unknown;
}

function getProvider(): Eip1193Provider | undefined {
  const candidate = (globalThis as { ethereum?: unknown }).ethereum;
  if (!candidate || typeof candidate !== 'object' || typeof (candidate as Eip1193Provider).request !== 'function') return undefined;
  return candidate as Eip1193Provider;
}

function validAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
}

function parseChainId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value !== 'string') return null;
  if (/^0x[0-9a-f]+$/i.test(value)) {
    const parsed = Number.parseInt(value.slice(2), 16);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  if (/^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function networkFor(chainId: number | null): { network: WalletNetwork; chainName: string } {
  if (chainId === PUBLIC_CONFIG.botchainChainId) return { network: 'BOT_CHAIN_TESTNET', chainName: 'BOT Chain Testnet' };
  if (chainId === PUBLIC_CONFIG.botchainMainnetChainId) return { network: 'BOT_CHAIN_MAINNET', chainName: 'BOT Chain Mainnet' };
  if (chainId === null) return { network: 'UNKNOWN', chainName: 'Unknown network' };
  return { network: 'WRONG_NETWORK', chainName: `Unsupported network · ${chainId}` };
}

function errorDetails(error: unknown): { code: string; message: string } {
  const candidate = error && typeof error === 'object' ? error as WalletErrorLike : {};
  const code = typeof candidate.code === 'string' || typeof candidate.code === 'number' ? String(candidate.code) : 'UNKNOWN';
  const raw = typeof candidate.message === 'string' ? candidate.message : 'The wallet request could not be completed.';
  const message = raw
    .replace(/(?:[a-z][a-z0-9+.-]*):\/\/[^\s]+/gi, '[url-redacted]')
    .replace(/(?:PRIVATE_KEY|SESSION_SECRET|DATABASE_URL|API_KEY|TOKEN)=?[^\s,;]*/gi, '[secret-redacted]')
    .slice(0, 220);
  if (code === '4001') return { code, message: 'The wallet request was rejected.' };
  if (code === '4902') return { code, message: 'This wallet does not know the requested network yet.' };
  return { code, message };
}

function initialSnapshot(providerPresent: boolean): WalletSnapshot {
  return {
    status: providerPresent ? 'DISCONNECTED' : 'UNAVAILABLE',
    providerPresent,
    address: null,
    chainId: null,
    chainName: 'No wallet detected',
    network: 'UNKNOWN',
    error: providerPresent ? null : { code: 'MISSING_WALLET', message: 'Install or unlock an EIP-1193 browser wallet to connect.' },
  };
}

export class BrowserWallet {
  private provider = getProvider();
  private readonly subscribers = new Set<(snapshot: WalletSnapshot) => void>();
  private snapshotValue = initialSnapshot(Boolean(this.provider));
  private eventsAttached = false;

  get snapshot(): WalletSnapshot { return this.snapshotValue; }

  getProvider(): Eip1193Provider | undefined { return this.provider; }

  subscribe(listener: (snapshot: WalletSnapshot) => void): () => void {
    this.subscribers.add(listener);
    listener(this.snapshotValue);
    return () => this.subscribers.delete(listener);
  }

  private publish(next: WalletSnapshot): void {
    this.snapshotValue = next;
    for (const listener of this.subscribers) listener(next);
  }

  private withChain(chainId: number | null, address: string | null, status: WalletSnapshot['status'], error: WalletSnapshot['error'] = null): WalletSnapshot {
    const network = networkFor(chainId);
    return {
      status,
      providerPresent: Boolean(this.provider),
      address,
      chainId,
      chainName: network.chainName,
      network: network.network,
      error,
    };
  }

  private attachEvents(): void {
    if (!this.provider || this.eventsAttached) return;
    this.eventsAttached = true;
    this.provider.on?.('accountsChanged', (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? args[0] : [];
      const address = validAddress(accounts[0]) ? accounts[0].toLowerCase() : null;
      if (!address) {
        const network = networkFor(this.snapshotValue.chainId);
        this.publish({ ...this.snapshotValue, status: 'DISCONNECTED', address: null, chainName: network.chainName, error: null });
        return;
      }
      this.publish({ ...this.snapshotValue, status: 'CONNECTED', address, error: null });
    });
    this.provider.on?.('chainChanged', (...args: unknown[]) => {
      const chainId = parseChainId(args[0]);
      const network = networkFor(chainId);
      this.publish({ ...this.snapshotValue, status: this.snapshotValue.address ? 'CONNECTED' : 'DISCONNECTED', chainId, chainName: network.chainName, network: network.network, error: null });
    });
  }

  private async sync(method: 'eth_accounts' | 'eth_requestAccounts'): Promise<void> {
    if (!this.provider) return;
    this.attachEvents();
    const accounts = await this.provider.request({ method });
    const address = Array.isArray(accounts) && validAddress(accounts[0]) ? accounts[0].toLowerCase() : null;
    const chainId = parseChainId(await this.provider.request({ method: 'eth_chainId' }));
    this.publish(this.withChain(chainId, address, address ? 'CONNECTED' : 'DISCONNECTED'));
  }

  async initialize(): Promise<void> {
    this.provider ??= getProvider();
    if (!this.provider) return;
    try {
      await this.sync('eth_accounts');
    } catch (error) {
      this.publish(this.withChain(null, null, 'ERROR', errorDetails(error)));
    }
  }

  async connect(): Promise<void> {
    this.provider ??= getProvider();
    if (!this.provider) {
      this.publish(initialSnapshot(false));
      return;
    }
    this.publish({ ...this.snapshotValue, status: 'CONNECTING', error: null });
    try {
      await this.sync('eth_requestAccounts');
    } catch (error) {
      this.publish({ ...this.snapshotValue, status: 'ERROR', address: null, error: errorDetails(error) });
    }
  }

  disconnect(): void {
    // EIP-1193 has no portable disconnect method. This is an explicit local
    // reset; the browser wallet's site permission remains under user control.
    const network = networkFor(this.snapshotValue.chainId);
    this.publish({ ...this.snapshotValue, status: 'DISCONNECTED', address: null, chainName: network.chainName, network: network.network, error: null });
  }

  async switchNetwork(chainId: number = PUBLIC_CONFIG.botchainChainId): Promise<void> {
    if (!this.provider) {
      this.publish(initialSnapshot(false));
      return;
    }
    const previous = this.snapshotValue;
    this.publish({ ...previous, status: 'SWITCHING', error: null });
    const hexChainId = `0x${chainId.toString(16)}`;
    try {
      await this.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] });
    } catch (switchError: any) {
      const code = switchError?.code || (switchError && typeof switchError === 'object' ? (switchError as any).code : undefined);
      if (code === 4902 || String(code) === '4902') {
        try {
          if (chainId === 968) {
            await this.provider.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: '0x3c8',
                  chainName: 'BOT Chain Testnet',
                  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
                  rpcUrls: ['https://rpc.bohr.life'],
                  blockExplorerUrls: ['https://scan.bohr.life/'],
                },
              ],
            });
          } else if (chainId === 677) {
            await this.provider.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: '0x2a5',
                  chainName: 'BOT Chain Mainnet',
                  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
                  rpcUrls: ['https://rpc.botchain.ai'],
                  blockExplorerUrls: ['https://scan.botchain.ai/'],
                },
              ],
            });
          }
        } catch (addError) {
          this.publish({ ...previous, status: previous.address ? 'CONNECTED' : 'ERROR', error: errorDetails(addError) });
          return;
        }
      } else {
        this.publish({ ...previous, status: previous.address ? 'CONNECTED' : 'ERROR', error: errorDetails(switchError) });
        return;
      }
    }
    try {
      const currentChainId = parseChainId(await this.provider.request({ method: 'eth_chainId' }));
      const network = networkFor(currentChainId);
      this.publish({
        ...this.snapshotValue,
        status: this.snapshotValue.address ? 'CONNECTED' : 'DISCONNECTED',
        chainId: currentChainId,
        chainName: network.chainName,
        network: network.network,
        error: null,
      });
    } catch (error) {
      this.publish({ ...previous, status: previous.address ? 'CONNECTED' : 'ERROR', error: errorDetails(error) });
    }
  }
}
