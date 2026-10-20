import fs from 'node:fs';
import path from 'node:path';

export type DeploymentManifest = {
  protocolVersion?: string;
  generatedAt?: string;
  source: {
    chainId: number;
    chainKey: number;
    contract: string;
    deployer: string;
    finalizer?: string;
    deploymentTx: string;
    deploymentBlock: number;
    rulesHash: string;
  };
  destination: {
    chainId: number;
    deployer: string;
    settlementWorker?: string;
    token: { address: string; deploymentTx: string; deploymentBlock: number };
    vault: { address: string; deploymentTx: string; deploymentBlock: number };
    asc: { address: string; deploymentTx: string; deploymentBlock: number };
    expectedBlockProver: string;
    expectedChainInfo: string;
  };
  compiler?: Record<string, unknown>;
};

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadDeploymentManifest(root: string): { manifest: DeploymentManifest; file: string } {
  const configured = process.env.PRIZERAIL_DEPLOYMENT_MANIFEST || 'evidence/current-deployment.json';
  const file = path.isAbsolute(configured) ? configured : path.join(root, configured);
  if (!fs.existsSync(file)) throw new Error(`deployment manifest is required: ${configured}`);
  const raw = readJson(file);
  if (raw.manifestPath) {
    const target = path.resolve(path.dirname(file), raw.manifestPath);
    if (!fs.existsSync(target)) throw new Error(`deployment manifest reference is missing: ${raw.manifestPath}`);
    return { manifest: readJson(target) as DeploymentManifest, file: target };
  }
  const manifest = raw as DeploymentManifest;
  if (!manifest.source?.contract || !manifest.destination?.vault?.address || !manifest.destination?.asc?.address) {
    throw new Error(`invalid deployment manifest: ${configured}`);
  }
  return { manifest, file };
}

export function roleKey(role: string, required = true): string | undefined {
  const directName = `${role.toUpperCase()}_PRIVATE_KEY`;
  const direct = process.env[directName]?.trim();
  if (direct) return direct;
  const reuse = process.env[`ROLE_REUSE_${role.toUpperCase()}`]?.trim();
  if (reuse) {
    const reused = process.env[`${reuse.toUpperCase()}_PRIVATE_KEY`]?.trim();
    if (!reused) throw new Error(`${directName} is absent and ROLE_REUSE_${role.toUpperCase()} points to missing ${reuse.toUpperCase()}_PRIVATE_KEY`);
    return reused;
  }
  if (required) throw new Error(`${directName} is required; set ROLE_REUSE_${role.toUpperCase()} explicitly only if reuse is intentional`);
  return undefined;
}

export function assertAddress(label: string, actual: string, expected: string): void {
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`${label} mismatch: ${actual} != ${expected}`);
}
