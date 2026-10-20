import assert from 'node:assert/strict';
import test from 'node:test';
import { launchPage } from './components.js';
import { launchPrizePolicy, type LaunchDraft } from './transactions.js';
import type { WalletSnapshot } from './domain.js';
import type { Eip1193Provider } from './wallet.js';

const draft: LaunchDraft = {
  tournamentId: `0x${'1'.repeat(64)}`,
  amount: '1',
  settlementDeadline: '1999999999',
  refundDeadline: '2000000000',
};

const connectedSepolia: WalletSnapshot = {
  status: 'CONNECTED',
  providerPresent: true,
  address: `0x${'1'.repeat(40)}`,
  chainId: 11155111,
  chainName: 'Ethereum Sepolia',
  network: 'SEPOLIA',
  error: null,
};

const connectedCc3: WalletSnapshot = {
  ...connectedSepolia,
  chainId: 102031,
  chainName: 'Creditcoin CC3',
  network: 'CREDITCOIN',
};

const unavailableProvider: Eip1193Provider = {
  request: async () => { throw new Error('provider must not be called'); },
};

test('launch refuses to write without a provider or a connected CC3 wallet', async () => {
  const noProvider = await launchPrizePolicy({ ...connectedCc3, providerPresent: false }, undefined, draft, () => {});
  assert.equal(noProvider.phase, 'FAIL');

  const wrongNetwork = await launchPrizePolicy(connectedSepolia, unavailableProvider, draft, () => {});
  assert.equal(wrongNetwork.phase, 'FAIL');
  assert.match(wrongNetwork.message, /Creditcoin CC3/);
});

test('launch rejects malformed identifiers before any wallet request', async () => {
  const updates: string[] = [];
  const result = await launchPrizePolicy(connectedCc3, unavailableProvider, { ...draft, tournamentId: '0x123' }, (state) => updates.push(state.message));
  assert.equal(result.phase, 'FAIL');
  assert.match(result.message, /Tournament ID/);
  assert.equal(updates.length, 1);
});

test('launch renderer exposes the real guarded organizer boundary', () => {
  const html = launchPage({
    status: 'DISCONNECTED',
    providerPresent: false,
    address: null,
    chainId: null,
    chainName: 'No wallet connected',
    network: 'UNKNOWN',
    error: null,
  }, {
    phase: 'FAIL',
    step: 'PRECHECK',
    message: 'Connect a wallet to begin.',
  }, { tournamentId: '', amount: '', settlementDeadline: '', refundDeadline: '' });

  assert.match(html, /data-launch-form/);
  assert.match(html, /Create and fund policy/);
  assert.match(html, /Connect a wallet to continue/);
  assert.match(html, /data-launch-status/);
  assert.match(html, /never calls the public test-token mint/);
  assert.doesNotMatch(html, /Write integration unavailable/);
});
