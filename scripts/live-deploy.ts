import fs from 'node:fs';
import path from 'node:path';
import { ContractFactory, JsonRpcProvider, Wallet, getCreateAddress, keccak256, parseEther } from 'ethers';
import { chainInfo } from '@gluwa/usc-sdk';
import { roleKey } from '../src/deployment.js';

const root = process.cwd();
const value = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v.replace(/\r$/, '');
};
const readEnv = () => {
  const file = fs.readFileSync(path.join(root, '.env'), 'utf8');
  for (const line of file.split(/\n/)) {
    const match = line.replace(/\r$/, '').match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
};
readEnv();

function artifact(name: string) { return JSON.parse(fs.readFileSync(path.join(root, 'artifacts', `${name}.json`), 'utf8')); }
async function deploy(name: string, signer: Wallet, args: unknown[] = []) {
  const a = artifact(name);
  const factory = new ContractFactory(a.abi, a.bytecode, signer);
  const contract = await factory.deploy(...args);
  const receipt = await (await contract.deploymentTransaction()!).wait();
  return { contract, receipt };
}
async function tx(contract: any, method: string, args: unknown[]) {
  const response = await contract[method](...args);
  const receipt = await response.wait();
  return { hash: response.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() };
}

const sepolia = new JsonRpcProvider(value('SEPOLIA_RPC_URL'));
const cc3 = new JsonRpcProvider(value('CREDITCOIN_RPC_URL'));
const deployerKey = value('DEPLOYER_PRIVATE_KEY');
const finalizerKey = roleKey('finalizer')!;
const workerKey = roleKey('worker')!;
const deployerSepolia = new Wallet(deployerKey, sepolia);
const deployerCc3 = new Wallet(deployerKey, cc3);
const finalizer = new Wallet(finalizerKey, sepolia);
const worker = new Wallet(workerKey, cc3);
const sourceNetwork = await sepolia.getNetwork();
const destinationNetwork = await cc3.getNetwork();
if (Number(sourceNetwork.chainId) !== 11155111) throw new Error(`unexpected source chain ${sourceNetwork.chainId}`);
if (Number(destinationNetwork.chainId) !== 102031) throw new Error(`unexpected destination chain ${destinationNetwork.chainId}`);
const supported = await new chainInfo.PrecompileChainInfoProvider(cc3 as any).getSupportedChains();
const sepoliaChain = supported.find((chain: any) => Number(chain.chainKey) === 1 && Number(chain.chainId) === 11155111);
if (!sepoliaChain) throw new Error('CC3 ChainInfo does not confirm Sepolia chain key 1');

const rulesHash = keccak256(Buffer.from('prizerail-rps-v1'));
const source = await deploy('TournamentResultRegistry', deployerSepolia, [finalizer.address]);
const sourceAddress = await source.contract.getAddress();
const sourceNonce = await sepolia.getTransactionCount(deployerSepolia.address, 'latest');
const destinationNonce = await cc3.getTransactionCount(deployerCc3.address, 'latest');
const predictedAsc = getCreateAddress({ from: deployerCc3.address, nonce: destinationNonce + 2 });
const token = await deploy('MockPrizeToken', deployerCc3);
const vault = await deploy('PrizeVault', deployerCc3, [predictedAsc]);
const asc = await deploy('PrizeRailASC', deployerCc3, [await vault.contract.getAddress(), 1]);
if ((await asc.contract.getAddress()).toLowerCase() !== predictedAsc.toLowerCase()) throw new Error('ASC prediction mismatch');

const manifest = {
  protocolVersion: 'post-fix-v2',
  generatedAt: new Date().toISOString(),
  source: { chainId: Number(sourceNetwork.chainId), chainKey: 1, contract: sourceAddress, deployer: deployerSepolia.address, finalizer: finalizer.address, deploymentTx: source.receipt?.hash, deploymentBlock: source.receipt?.blockNumber, rulesHash },
  destination: { chainId: Number(destinationNetwork.chainId), deployer: deployerCc3.address, settlementWorker: worker.address, token: { address: await token.contract.getAddress(), deploymentTx: token.receipt?.hash, deploymentBlock: token.receipt?.blockNumber }, vault: { address: await vault.contract.getAddress(), deploymentTx: vault.receipt?.hash, deploymentBlock: vault.receipt?.blockNumber }, asc: { address: await asc.contract.getAddress(), deploymentTx: asc.receipt?.hash, deploymentBlock: asc.receipt?.blockNumber }, expectedBlockProver: value('ATTESTCOIN_BLOCK_PROVER_ADDRESS'), expectedChainInfo: value('ATTESTCOIN_CHAIN_INFO_ADDRESS') },
  compiler: { solc: '0.8.28', optimizer: true, optimizerRuns: 200, viaIR: true, evmVersion: 'shanghai', attestcoinContracts: '@gluwa/asc-contracts@0.2.1' },
};
fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
const versionedName = `post-fix-deployment-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const versionedPath = path.join(root, 'evidence', versionedName);
fs.writeFileSync(versionedPath, JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(root, 'evidence', 'current-deployment.json'), JSON.stringify({ manifestPath: versionedName, protocolVersion: manifest.protocolVersion, generatedAt: manifest.generatedAt }, null, 2));
console.log(JSON.stringify({ manifestPath: path.relative(root, versionedPath), current: 'evidence/current-deployment.json', ...manifest }, null, 2));
