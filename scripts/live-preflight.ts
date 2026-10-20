import 'dotenv/config';
import { JsonRpcProvider, Wallet, formatEther } from 'ethers';
import { chainInfo } from '@gluwa/usc-sdk';
import { roleKey } from '../src/deployment.js';
import { safeError } from '../src/worker-runtime.js';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const sepolia = new JsonRpcProvider(env('SEPOLIA_RPC_URL'));
const creditcoin = new JsonRpcProvider(env('CREDITCOIN_RPC_URL'));
const deployer = new Wallet(env('DEPLOYER_PRIVATE_KEY'));
const finalizer = new Wallet(roleKey('finalizer')!);
const organizer = new Wallet(roleKey('organizer')!);
const playerOne = new Wallet(roleKey('player_one')!);
const playerTwo = new Wallet(roleKey('player_two')!);
const worker = new Wallet(roleKey('worker')!);
const payoutTrigger = new Wallet(roleKey('payout_trigger')!);
const proverUrl = env('ATTESTCOIN_PROVER_URL');
const [sepoliaNetwork, creditcoinNetwork, supportedChains, deployerSepolia, finalizerSepolia, playerOneSepolia, playerTwoSepolia, deployerCc3, organizerCc3, workerCc3, payoutCc3, proverHealth] = await Promise.all([
  sepolia.getNetwork(),
  creditcoin.getNetwork(),
  new chainInfo.PrecompileChainInfoProvider(creditcoin as any).getSupportedChains(),
  sepolia.getBalance(deployer.address),
  sepolia.getBalance(finalizer.address),
  sepolia.getBalance(playerOne.address),
  sepolia.getBalance(playerTwo.address),
  creditcoin.getBalance(deployer.address),
  creditcoin.getBalance(organizer.address),
  creditcoin.getBalance(worker.address),
  creditcoin.getBalance(payoutTrigger.address),
  fetch(proverUrl, { signal: AbortSignal.timeout(15_000) }).then((response) => ({ status: response.status, ok: response.ok })).catch((error) => ({ status: null, ok: false, error: safeError(error) })),
]);

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  networks: { sepolia: Number(sepoliaNetwork.chainId), creditcoin: Number(creditcoinNetwork.chainId) },
  supportedChains,
  prover: { configured: true, ...proverHealth },
  wallets: {
    deployer: { address: deployer.address, sepolia: formatEther(deployerSepolia), creditcoin: formatEther(deployerCc3) },
    finalizer: { address: finalizer.address, sepolia: formatEther(finalizerSepolia) },
    organizer: { address: organizer.address, creditcoin: formatEther(organizerCc3) },
    playerOne: { address: playerOne.address, sepolia: formatEther(playerOneSepolia) },
    playerTwo: { address: playerTwo.address, sepolia: formatEther(playerTwoSepolia) },
    worker: { address: worker.address, creditcoin: formatEther(workerCc3) },
    payoutTrigger: { address: payoutTrigger.address, creditcoin: formatEther(payoutCc3) },
  },
}, null, 2));
