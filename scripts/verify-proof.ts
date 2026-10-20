import fs from 'node:fs';
import path from 'node:path';
import { keccak256 } from 'ethers';
import { getAttestcoinProof } from '../src/attestcoin.js';
import { assessReconstructedProof } from '../src/proof-verification.js';
import { safeError } from '../src/worker-runtime.js';

const root = process.cwd();
const evidencePath = process.argv[2] ?? 'evidence/live-latest.json';
const evidence = JSON.parse(fs.readFileSync(path.resolve(root, evidencePath), 'utf8'));
const sourceRpc = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const creditcoinRpc = process.env.CREDITCOIN_RPC_URL || 'https://rpc.cc3-testnet.creditcoin.network';
const proverUrl = process.env.ATTESTCOIN_PROVER_URL || 'https://prover.cc3-testnet.creditcoin.network';
try {
  const expectedChainKey = evidence.source.chainKey === undefined && Number(evidence.source.chainId) === 11155111 ? 1 : Number(evidence.source.chainKey);
  const result = await getAttestcoinProof(sourceRpc, creditcoinRpc, proverUrl, evidence.source.transaction.hash, expectedChainKey);
  const assessment = assessReconstructedProof(evidence.attestation ?? {}, {
    proofIdentifier: keccak256(result.proof.txBytes),
    headerNumber: result.proof.headerNumber,
    nativeVerified: result.verified,
  });
  console.log(JSON.stringify({
    evidence: evidencePath,
    mode: 'read-only-proof-reconstruction',
    writesPerformed: false,
    hostedProverCached: result.proof.cached ?? null,
    proofShape: {
      encodedTransactionBytes: (result.proof.txBytes.length - 2) / 2,
      merkleSiblings: result.proof.merkleProof.siblings.length,
      continuityRoots: result.proof.continuityProof.roots.length,
      headerNumber: result.proof.headerNumber,
    },
    ...assessment,
  }, null, 2));
  process.exit(assessment.status === 'FAIL' ? 1 : 0);
} catch (error) {
  console.log(JSON.stringify({
    evidence: evidencePath,
    mode: 'read-only-proof-reconstruction',
    writesPerformed: false,
    status: 'UNKNOWN',
    detail: `proof reconstruction/preflight unavailable: ${safeError(error)}`,
  }, null, 2));
  process.exit(0);
}
