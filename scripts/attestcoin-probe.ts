import { getAttestcoinProof } from '../src/attestcoin.js';

for (const line of (await import('node:fs')).readFileSync('.env', 'utf8').split(/\n/)) {
  const match = line.replace(/\r$/, '').match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}

const [txHash] = process.argv.slice(2);
if (!txHash) throw new Error('usage: npm run attestcoin:probe -- <sepolia-tx-hash>');
const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const result = await getAttestcoinProof(env('SEPOLIA_RPC_URL'), env('CREDITCOIN_RPC_URL'), env('ATTESTCOIN_PROVER_URL'), txHash, Number(env('ATTESTCOIN_SOURCE_CHAIN_KEY')));
console.log(JSON.stringify({ txHash, supportedChains: result.supportedChains, proof: { chainKey: result.proof.chainKey, headerNumber: result.proof.headerNumber, cached: result.proof.cached }, verified: result.verified }, null, 2));
