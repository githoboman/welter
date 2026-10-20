import fs from 'node:fs';
import path from 'node:path';
import { ContractFactory, JsonRpcProvider, Wallet, getCreateAddress, keccak256, formatEther, parseEther } from 'ethers';

const root = process.cwd();

const readEnv = () => {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return {};
  const file = fs.readFileSync(envPath, 'utf8');
  const res: Record<string, string> = {};
  for (const line of file.split(/\n/)) {
    const match = line.replace(/\r$/, '').match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) {
      res[match[1]] = match[2].trim();
      if (!process.env[match[1]]) process.env[match[1]] = match[2].trim();
    }
  }
  return res;
};

const env = readEnv();

const BOTCHAIN_RPC_URL = process.env.BOTCHAIN_RPC_URL || 'https://rpc.bohr.life';
const BOTCHAIN_CHAIN_ID = 968;
const BOTCHAIN_EXPLORER_URL = 'https://scan.bohr.life';

function artifact(name: string) {
  const file = path.join(root, 'artifacts', `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`Artifact ${name} not found. Run "npm run compile:direct" first.`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function deployContract(name: string, signer: Wallet, args: unknown[] = []) {
  const a = artifact(name);
  const factory = new ContractFactory(a.abi, a.bytecode, signer);
  const feeData = await signer.provider!.getFeeData();
  const gasPrice = feeData.gasPrice ?? 20000000000n;
  console.log(`Deploying ${name} with gasPrice: ${gasPrice.toString()}...`);
  const contract = await factory.deploy(...args, { gasPrice });
  const deploymentTx = contract.deploymentTransaction();
  console.log(`Submitted ${name} deployment tx: ${deploymentTx?.hash}`);
  const receipt = await deploymentTx!.wait();
  const address = await contract.getAddress();
  console.log(`✓ ${name} deployed to: ${address} (block ${receipt?.blockNumber})`);
  return { contract, address, receipt, txHash: deploymentTx?.hash };
}

async function main() {
  const provider = new JsonRpcProvider(BOTCHAIN_RPC_URL);
  const network = await provider.getNetwork();
  console.log(`Connected to BOT Chain (Chain ID: ${network.chainId}) via ${BOTCHAIN_RPC_URL}`);

  if (Number(network.chainId) !== BOTCHAIN_CHAIN_ID) {
    throw new Error(`Connected network chainId ${network.chainId} is not BOT Chain Testnet (${BOTCHAIN_CHAIN_ID})`);
  }

  let privateKey = process.env.BOTCHAIN_DEPLOYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;

  if (!privateKey || privateKey.startsWith('0xYOUR_') || privateKey.length < 64) {
    // Generate a dedicated deployment wallet if not set
    const freshWallet = Wallet.createRandom();
    console.log(`\n===============================================================`);
    console.log(`No valid deployer private key found in .env.`);
    console.log(`Generated a dedicated BOT Chain deployment address:`);
    console.log(`  Address:    ${freshWallet.address}`);
    console.log(`  Private Key: ${freshWallet.privateKey}`);
    console.log(`===============================================================`);
    console.log(`Please claim testnet BOT tokens from the official faucet:`);
    console.log(`  Faucet: https://faucet.botchain.ai/basic`);
    console.log(`  Enter:  ${freshWallet.address}`);
    console.log(`Then rerun this deployment script after tokens arrive.`);
    console.log(`===============================================================\n`);

    // Append/save to .env
    const envPath = path.join(root, '.env');
    let existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    if (!existing.includes('BOTCHAIN_DEPLOYER_PRIVATE_KEY=')) {
      existing += `\nBOTCHAIN_DEPLOYER_PRIVATE_KEY=${freshWallet.privateKey}\n`;
      existing += `BOTCHAIN_RPC_URL=https://rpc.bohr.life\n`;
      fs.writeFileSync(envPath, existing);
    }
    process.exit(1);
  }

  const deployer = new Wallet(privateKey, provider);
  console.log(`Deployer address: ${deployer.address}`);

  const balance = await provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${formatEther(balance)} BOT`);

  if (balance === 0n) {
    console.error(`\n[ERROR] Deployer ${deployer.address} has 0 BOT balance!`);
    console.error(`Please fund this address using the BOT Chain Testnet faucet:`);
    console.error(`  --> https://faucet.botchain.ai/basic`);
    console.error(`Address to fund: ${deployer.address}`);
    process.exit(1);
  }

  const rulesHash = keccak256(Buffer.from('prizerail-rps-v1'));

  // 1. Deploy TournamentResultRegistry
  const registry = await deployContract('TournamentResultRegistry', deployer, [deployer.address]);

  // 2. Predict Settler address so Vault can be pointed to it
  const currentNonce = await provider.getTransactionCount(deployer.address, 'latest');
  // Next deploy is MockPrizeToken (nonce), then PrizeVault (nonce + 1), then BotChainSettler (nonce + 2)
  const predictedSettler = getCreateAddress({ from: deployer.address, nonce: currentNonce + 2 });
  console.log(`Predicted BotChainSettler address: ${predictedSettler}`);

  // 3. Deploy MockPrizeToken
  const token = await deployContract('MockPrizeToken', deployer);

  // 4. Deploy PrizeVault with settlementAuthority = predictedSettler
  const vault = await deployContract('PrizeVault', deployer, [predictedSettler]);

  // 5. Deploy BotChainSettler
  const settler = await deployContract('BotChainSettler', deployer, [vault.address, registry.address]);

  if (settler.address.toLowerCase() !== predictedSettler.toLowerCase()) {
    throw new Error(`Predicted settler ${predictedSettler} does not match deployed ${settler.address}`);
  }

  const manifest = {
    protocolVersion: 'botchain-v1',
    network: 'BOT Chain Testnet',
    generatedAt: new Date().toISOString(),
    source: {
      chainId: BOTCHAIN_CHAIN_ID,
      chainKey: BOTCHAIN_CHAIN_ID,
      contract: registry.address,
      deployer: deployer.address,
      finalizer: deployer.address,
      deploymentTx: registry.txHash,
      deploymentBlock: registry.receipt?.blockNumber,
      rulesHash,
    },
    destination: {
      chainId: BOTCHAIN_CHAIN_ID,
      deployer: deployer.address,
      settlementWorker: deployer.address,
      token: {
        address: token.address,
        deploymentTx: token.txHash,
        deploymentBlock: token.receipt?.blockNumber,
      },
      vault: {
        address: vault.address,
        deploymentTx: vault.txHash,
        deploymentBlock: vault.receipt?.blockNumber,
      },
      settler: {
        address: settler.address,
        deploymentTx: settler.txHash,
        deploymentBlock: settler.receipt?.blockNumber,
      },
    },
    explorers: {
      network: BOTCHAIN_EXPLORER_URL,
      registry: `${BOTCHAIN_EXPLORER_URL}/address/${registry.address}`,
      token: `${BOTCHAIN_EXPLORER_URL}/address/${token.address}`,
      vault: `${BOTCHAIN_EXPLORER_URL}/address/${vault.address}`,
      settler: `${BOTCHAIN_EXPLORER_URL}/address/${settler.address}`,
    },
  };

  fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
  const manifestFile = `botchain-deployment-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path.join(root, 'evidence', manifestFile), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(
    path.join(root, 'evidence', 'current-deployment.json'),
    JSON.stringify({ manifestPath: manifestFile, protocolVersion: manifest.protocolVersion, generatedAt: manifest.generatedAt }, null, 2)
  );

  console.log('\n===============================================================');
  console.log('BOT CHAIN TESTNET DEPLOYMENT SUCCESSFUL!');
  console.log('===============================================================');
  console.log(`TournamentResultRegistry: ${registry.address}`);
  console.log(`PrizeToken:               ${token.address}`);
  console.log(`PrizeVault:               ${vault.address}`);
  console.log(`BotChainSettler:          ${settler.address}`);
  console.log(`Explorer URLs:`);
  console.log(`  Vault:    ${BOTCHAIN_EXPLORER_URL}/address/${vault.address}`);
  console.log(`  Registry: ${BOTCHAIN_EXPLORER_URL}/address/${registry.address}`);
  console.log(`===============================================================\n`);
}

main().catch((err) => {
  console.error('Deployment error:', err);
  process.exit(1);
});
