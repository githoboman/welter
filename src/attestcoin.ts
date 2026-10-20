import { JsonRpcProvider } from 'ethers';
import { blockProver, chainInfo, proofProvider } from '@gluwa/usc-sdk';

export type ProofData = {
  chainKey: number;
  headerNumber: number;
  txHash: string;
  txBytes: string;
  merkleProof: { root: string; siblings: readonly { hash: string; isLeft: boolean }[] };
  continuityProof: { lowerEndpointDigest: string; roots: readonly string[] };
  cached?: boolean;
};

export async function getAttestcoinProof(sourceRpc: string, creditcoinRpc: string, proverUrl: string, txHash: string, expectedChainKey: number, expectedChainInfoAddress?: string, expectedBlockProverAddress?: string): Promise<{ proof: ProofData; verified: boolean; supportedChains: readonly unknown[] }> {
  const sourceProvider = new JsonRpcProvider(sourceRpc);
  const creditcoinProvider = new JsonRpcProvider(creditcoinRpc);
  // usc-sdk 0.18.0's declarations resolve ethers through a different export
  // condition under NodeNext, despite npm deduping the same runtime package.
  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoinProvider as any, expectedChainInfoAddress);
  const supportedChains = await chainInfoProvider.getSupportedChains();
  const source = supportedChains.find((entry: any) => Number(entry.chainKey) === expectedChainKey);
  if (!source || Number((source as any).chainId) !== 11155111) throw new Error('Configured Attestcoin chain key is not Ethereum Sepolia');
  const tx = await sourceProvider.getTransaction(txHash);
  if (!tx?.blockNumber) throw new Error('Source transaction is not mined');
  const receipt = await sourceProvider.getTransactionReceipt(txHash);
  if (!receipt || receipt.status !== 1) throw new Error('Source transaction receipt is not successful');
  const builder = new proofProvider.service.ProofBuilder(expectedChainKey, proverUrl, 15000);
  await builder.waitUntilHeightAttested(expectedChainKey, tx.blockNumber);
  const result = await builder.getProof(txHash);
  if (!result.success || !result.data) throw new Error(`Proof generation failed: ${result.error}`);
  const proof = result.data as unknown as ProofData;
  const prover = new blockProver.PrecompileBlockProver(creditcoinProvider as any, expectedBlockProverAddress);
  const verified = await prover.verifySingle(
    proof.chainKey,
    proof.headerNumber,
    proof.txBytes,
    { root: proof.merkleProof.root, siblings: [...proof.merkleProof.siblings] },
    { lowerEndpointDigest: proof.continuityProof.lowerEndpointDigest, roots: [...proof.continuityProof.roots] },
  );
  return { proof, verified, supportedChains };
}
