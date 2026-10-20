import type { DeploymentConfig } from './domain.js';

interface PublicConfigOverrides {
  botchainChainId?: number;
  botchainMainnetChainId?: number;
  botchainExplorer?: string;
  botchainRpc?: string;
  faucetUrl?: string;
  sourceRegistry?: string;
  sourceRulesHash?: string;
  sourceFinalizer?: string;
  prizeToken?: string;
  prizeVault?: string;
  botchainSettler?: string;
  prizerailAsc?: string;
  apiBaseUrl?: string;
  currentWorkerTournamentId?: string;
  sepoliaChainId?: number;
  creditcoinChainId?: number;
}

declare const __PRIZERAIL_PUBLIC_CONFIG__: PublicConfigOverrides | undefined;

const buildOverrides: PublicConfigOverrides = typeof __PRIZERAIL_PUBLIC_CONFIG__ === 'undefined'
  ? {}
  : __PRIZERAIL_PUBLIC_CONFIG__;

function configuredNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function configuredString(value: string | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

// Browser-safe deployment metadata for BOT Chain.
export const PUBLIC_CONFIG = {
  botchainChainId: configuredNumber(buildOverrides.botchainChainId, 968),
  botchainMainnetChainId: configuredNumber(buildOverrides.botchainMainnetChainId, 677),
  botchainExplorer: configuredString(buildOverrides.botchainExplorer, 'https://scan.bohr.life/'),
  botchainRpc: configuredString(buildOverrides.botchainRpc, 'https://rpc.bohr.life'),
  faucetUrl: configuredString(buildOverrides.faucetUrl, 'https://faucet.botchain.ai/basic'),
  sourceRegistry: configuredString(buildOverrides.sourceRegistry, '0x4E64c9a173440e1375460605b7959C3093370d78'),
  sourceRulesHash: configuredString(buildOverrides.sourceRulesHash, '0x7564123213f3cffdfa6237a0067717f6f1a13dc65a0b69e6960cbe5ca8c94331'),
  sourceFinalizer: configuredString(buildOverrides.sourceFinalizer, '0x29108bAb564B53B19C5dde4D00048DB6C41e057C'),
  prizeToken: configuredString(buildOverrides.prizeToken, '0x5A165Cb40fcF5E97ed7f9af37f45a19C1236f664'),
  prizeVault: configuredString(buildOverrides.prizeVault, '0x6edC23FD53d5f861c460397337f505DDF88fCB32'),
  botchainSettler: configuredString(buildOverrides.botchainSettler, '0x81f6611d25a7533885dd34bce10600aff0E2E4DE'),
  prizerailAsc: configuredString(buildOverrides.prizerailAsc, '0x81f6611d25a7533885dd34bce10600aff0E2E4DE'),
  apiBaseUrl: configuredString(buildOverrides.apiBaseUrl, 'http://localhost:3000/api/v1'),
  currentWorkerTournamentId: configuredString(buildOverrides.currentWorkerTournamentId, '0x38068ece64fe32ff70d3de7445ec16350ff2f661e13dffbdccd91bbe96f2ae47'),
  // Legacy aliases for backward compatibility with existing tests
  sepoliaChainId: configuredNumber(buildOverrides.sepoliaChainId, 968),
  creditcoinChainId: configuredNumber(buildOverrides.creditcoinChainId, 968),
  attestcoinChainKey: 968,
  sepoliaExplorer: configuredString(buildOverrides.botchainExplorer, 'https://scan.bohr.life/tx/'),
  creditcoinExplorer: configuredString(buildOverrides.botchainExplorer, 'https://scan.bohr.life/tx/'),
} as const;

export const STATIC_DEPLOYMENT: DeploymentConfig = {
  protocolVersion: 'botchain-v1',
  generatedAt: '2026-10-20T12:00:00.000Z',
  source: {
    chainId: PUBLIC_CONFIG.botchainChainId,
    chainKey: PUBLIC_CONFIG.botchainChainId,
    contract: PUBLIC_CONFIG.sourceRegistry,
    finalizer: PUBLIC_CONFIG.sourceFinalizer,
    deploymentTx: '0x0000000000000000000000000000000000000000000000000000000000000000',
    deploymentBlock: 1,
    rulesHash: PUBLIC_CONFIG.sourceRulesHash,
  },
  destination: {
    chainId: PUBLIC_CONFIG.botchainChainId,
    settlementWorker: '0x96d6E03B89f6bf073CF8ab42B75e86f6fFEA2082',
    token: {
      address: PUBLIC_CONFIG.prizeToken,
      deploymentTx: '0x0000000000000000000000000000000000000000000000000000000000000000',
      deploymentBlock: 1,
    },
    vault: {
      address: PUBLIC_CONFIG.prizeVault,
      deploymentTx: '0x0000000000000000000000000000000000000000000000000000000000000000',
      deploymentBlock: 1,
    },
    asc: {
      address: PUBLIC_CONFIG.prizerailAsc,
      deploymentTx: '0x0000000000000000000000000000000000000000000000000000000000000000',
      deploymentBlock: 1,
    },
    expectedBlockProver: '0x0000000000000000000000000000000000000FD2',
    expectedChainInfo: '0x0000000000000000000000000000000000000fd3',
  },
};
