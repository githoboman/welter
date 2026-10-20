import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_CONFIG } from './config.js';
import { BrowserWallet } from './wallet.js';

type Listener = (...args: unknown[]) => void;

class TestProvider {
  accounts: string[] = [];
  chainId = `0x${PUBLIC_CONFIG.sepoliaChainId.toString(16)}`;
  rejectMethod: string | null = null;
  readonly calls: Array<{ method: string; params?: readonly unknown[] }> = [];
  private readonly listeners = new Map<string, Listener[]>();

  async request(args: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    this.calls.push(args);
    if (args.method === this.rejectMethod) throw { code: 4001, message: 'provider detail should not be shown' };
    if (args.method === 'eth_accounts' || args.method === 'eth_requestAccounts') return this.accounts;
    if (args.method === 'eth_chainId') return this.chainId;
    if (args.method === 'wallet_switchEthereumChain') {
      const first = args.params?.[0] as { chainId?: unknown } | undefined;
      if (typeof first?.chainId !== 'string') throw new Error('missing chain id');
      this.chainId = first.chainId;
      return null;
    }
    throw new Error(`unexpected method ${args.method}`);
  }

  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  emit(event: string, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}

function installProvider(provider?: TestProvider): void {
  const target = globalThis as { ethereum?: unknown };
  if (provider) target.ethereum = provider;
  else delete target.ethereum;
}

test('missing wallet remains explicit and a later provider can connect', async () => {
  installProvider();
  const wallet = new BrowserWallet();
  assert.equal(wallet.snapshot.status, 'UNAVAILABLE');

  const provider = new TestProvider();
  provider.accounts = ['0x1111111111111111111111111111111111111111'];
  installProvider(provider);
  await wallet.connect();

  assert.equal(wallet.snapshot.status, 'CONNECTED');
  assert.equal(wallet.snapshot.address, provider.accounts[0]);
  assert.equal(wallet.snapshot.network, 'SEPOLIA');
});

test('connection, account events, chain events, switching, and local reset update observable state', async () => {
  const provider = new TestProvider();
  provider.accounts = ['0x2222222222222222222222222222222222222222'];
  installProvider(provider);
  const wallet = new BrowserWallet();

  await wallet.initialize();
  assert.equal(wallet.snapshot.status, 'CONNECTED');
  assert.equal(wallet.snapshot.network, 'SEPOLIA');

  provider.emit('chainChanged', '0x1');
  assert.equal(wallet.snapshot.network, 'WRONG_NETWORK');
  assert.match(wallet.snapshot.chainName, /Unsupported network/);

  await wallet.switchNetwork(PUBLIC_CONFIG.creditcoinChainId);
  assert.equal(wallet.snapshot.network, 'CREDITCOIN');
  assert.equal(wallet.snapshot.chainId, PUBLIC_CONFIG.creditcoinChainId);
  assert.ok(provider.calls.some((call) => call.method === 'wallet_switchEthereumChain'));

  provider.emit('accountsChanged', ['0x3333333333333333333333333333333333333333']);
  assert.equal(wallet.snapshot.address, '0x3333333333333333333333333333333333333333');

  provider.emit('accountsChanged', []);
  assert.equal(wallet.snapshot.status, 'DISCONNECTED');
  assert.equal(wallet.snapshot.address, null);

  provider.accounts = ['0x2222222222222222222222222222222222222222'];
  await wallet.connect();
  wallet.disconnect();
  assert.equal(wallet.snapshot.status, 'DISCONNECTED');
  assert.equal(wallet.snapshot.address, null);
});

test('rejected connection and rejected switch remain distinct wallet errors', async () => {
  const rejectedConnection = new TestProvider();
  rejectedConnection.rejectMethod = 'eth_requestAccounts';
  installProvider(rejectedConnection);
  const disconnectedWallet = new BrowserWallet();
  await disconnectedWallet.connect();
  assert.equal(disconnectedWallet.snapshot.status, 'ERROR');
  assert.deepEqual(disconnectedWallet.snapshot.error, { code: '4001', message: 'The wallet request was rejected.' });

  const rejectedSwitch = new TestProvider();
  rejectedSwitch.accounts = ['0x4444444444444444444444444444444444444444'];
  installProvider(rejectedSwitch);
  const connectedWallet = new BrowserWallet();
  await connectedWallet.initialize();
  rejectedSwitch.rejectMethod = 'wallet_switchEthereumChain';
  await connectedWallet.switchNetwork(PUBLIC_CONFIG.creditcoinChainId);
  assert.equal(connectedWallet.snapshot.status, 'CONNECTED');
  assert.equal(connectedWallet.snapshot.address, rejectedSwitch.accounts[0]);
  assert.deepEqual(connectedWallet.snapshot.error, { code: '4001', message: 'The wallet request was rejected.' });
});
