import fs from 'node:fs';
import path from 'node:path';
import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes, parseEther, formatEther, AbiCoder } from 'ethers';

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

readEnv();

const BOTCHAIN_RPC_URL = process.env.BOTCHAIN_RPC_URL || 'https://rpc.bohr.life';
const privateKey = process.env.BOTCHAIN_DEPLOYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;

if (!privateKey) {
  throw new Error('BOTCHAIN_DEPLOYER_PRIVATE_KEY is missing in .env');
}

function artifact(name: string) {
  const file = path.join(root, 'artifacts', `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`Artifact ${name} not found`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

interface TxRecord {
  step: number;
  action: string;
  txHash: string;
  blockNumber: number;
  gasUsed: string;
  explorerUrl: string;
  description: string;
}

async function main() {
  console.log('Connecting to BOT Chain Testnet (RPC:', BOTCHAIN_RPC_URL, ')...');
  const provider = new JsonRpcProvider(BOTCHAIN_RPC_URL);
  const deployer = new Wallet(privateKey, provider);
  const deployerAddress = await deployer.getAddress();
  const balance = await provider.getBalance(deployerAddress);
  console.log(`Connected with account: ${deployerAddress} (Balance: ${formatEther(balance)} BOT)`);

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 20000000000n;

  // Contract Addresses from deployment
  const REGISTRY_ADDR = '0x4E64c9a173440e1375460605b7959C3093370d78';
  const TOKEN_ADDR = '0x5A165Cb40fcF5E97ed7f9af37f45a19C1236f664';
  const VAULT_ADDR = '0x6edC23FD53d5f861c460397337f505DDF88fCB32';
  const SETTLER_ADDR = '0x81f6611d25a7533885dd34bce10600aff0E2E4DE';

  const registryArtifact = artifact('TournamentResultRegistry');
  const tokenArtifact = artifact('MockPrizeToken');
  const vaultArtifact = artifact('PrizeVault');
  const settlerArtifact = artifact('BotChainSettler');

  const registry = new Contract(REGISTRY_ADDR, registryArtifact.abi, deployer);
  const token = new Contract(TOKEN_ADDR, tokenArtifact.abi, deployer);
  const vault = new Contract(VAULT_ADDR, vaultArtifact.abi, deployer);
  const settler = new Contract(SETTLER_ADDR, settlerArtifact.abi, deployer);

  const txRecords: TxRecord[] = [];

  async function recordTx(step: number, action: string, txPromise: Promise<any>, description: string) {
    console.log(`\n[Step ${step}] Executing: ${action}...`);
    const tx = await txPromise;
    console.log(`Tx sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✓ Mined in block ${receipt.blockNumber} (Gas used: ${receipt.gasUsed.toString()})`);
    const record: TxRecord = {
      step,
      action,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      explorerUrl: `https://scan.bohr.life/tx/${tx.hash}`,
      description,
    };
    txRecords.push(record);
    return receipt;
  }

  // Generate Player 2 and fund with gas
  const playerTwo = Wallet.createRandom().connect(provider);
  const playerTwoAddress = await playerTwo.getAddress();
  console.log(`Generated Player Two: ${playerTwoAddress}`);

  // Tx 1: Fund Player 2 with gas
  await recordTx(
    1,
    'Fund Player Two Gas',
    deployer.sendTransaction({ to: playerTwoAddress, value: parseEther('0.05'), gasPrice }),
    `Transferred 0.05 BOT to player 2 (${playerTwoAddress}) for on-chain tournament gameplay interactions.`
  );

  // Tx 2: Mint Prize Tokens to Organizer
  const prizeAmount = parseEther('100');
  await recordTx(
    2,
    'Mint PRIZE Tokens',
    token.mint(deployerAddress, parseEther('1000'), { gasPrice }),
    `Minted 1,000 PRIZE test tokens to tournament organizer (${deployerAddress}).`
  );

  // Tx 3: Approve PrizeVault for Escrow
  await recordTx(
    3,
    'Approve PrizeVault Allowance',
    token.approve(VAULT_ADDR, prizeAmount, { gasPrice }),
    `Approved PrizeVault (${VAULT_ADDR}) to pull 100 PRIZE for tournament prize escrow.`
  );

  // Unique tournament & match IDs
  const timestamp = Math.floor(Date.now() / 1000);
  const tournamentId = keccak256(toUtf8Bytes(`BOTCHAIN-TOURNAMENT-${Date.now()}`));
  const matchId = keccak256(toUtf8Bytes(`MATCH-${Date.now()}`));
  const rulesHash = '0x7564123213f3cffdfa6237a0067717f6f1a13dc65a0b69e6960cbe5ca8c94331';
  const settlementDeadline = BigInt(timestamp + 86400);
  const refundDeadline = BigInt(timestamp + 172800);

  // Tx 4: Create Tournament Prize Policy in PrizeVault
  await recordTx(
    4,
    'Create Tournament Prize Policy',
    vault.createTournament(
      tournamentId,
      deployerAddress,
      968n,
      REGISTRY_ADDR,
      rulesHash,
      TOKEN_ADDR,
      prizeAmount,
      settlementDeadline,
      refundDeadline,
      { gasPrice }
    ),
    `Registered immutable prize policy for tournament ${tournamentId.slice(0, 18)}... with 100 PRIZE purse.`
  );

  // Tx 5: Fund PrizeVault Escrow
  await recordTx(
    5,
    'Fund PrizeVault Escrow',
    vault.fund(tournamentId, { gasPrice }),
    `Funded 100 PRIZE tokens into non-custodial PrizeVault escrow contract.`
  );

  // Tx 6: Create Match in TournamentResultRegistry
  const revealDeadline = BigInt(timestamp + 3600);
  await recordTx(
    6,
    'Create Match in Registry',
    registry.createMatch(
      tournamentId,
      matchId,
      deployerAddress,
      playerTwoAddress,
      rulesHash,
      revealDeadline,
      { gasPrice }
    ),
    `Initialized match ${matchId.slice(0, 18)}... between Player 1 (deployer) and Player 2.`
  );

  // Moves: Player 1 = Rock (Choice 1), Player 2 = Scissors (Choice 3) => Player 1 Wins!
  const abiCoder = AbiCoder.defaultAbiCoder();
  const saltOne = keccak256(toUtf8Bytes('playerOneSalt123'));
  const saltTwo = keccak256(toUtf8Bytes('playerTwoSalt456'));
  const commitOne = keccak256(abiCoder.encode(['uint8', 'bytes32'], [1, saltOne]));
  const commitTwo = keccak256(abiCoder.encode(['uint8', 'bytes32'], [3, saltTwo]));

  // Tx 7: Player 1 Commit Move
  await recordTx(
    7,
    'Player 1 Commit Move',
    registry.commit(matchId, commitOne, { gasPrice }),
    `Player 1 submitted cryptographic move commitment.`
  );

  // Tx 8: Player 2 Commit Move
  const registryP2 = registry.connect(playerTwo) as Contract;
  await recordTx(
    8,
    'Player 2 Commit Move',
    registryP2.commit(matchId, commitTwo, { gasPrice }),
    `Player 2 submitted cryptographic move commitment.`
  );

  // Tx 9: Player 1 Reveal Move (Rock)
  await recordTx(
    9,
    'Player 1 Reveal Move',
    registry.reveal(matchId, 1, saltOne, { gasPrice }),
    `Player 1 revealed move: Rock (Choice 1).`
  );

  // Tx 10: Player 2 Reveal Move (Scissors)
  await recordTx(
    10,
    'Player 2 Reveal Move',
    registryP2.reveal(matchId, 3, saltTwo, { gasPrice }),
    `Player 2 revealed move: Scissors (Choice 3).`
  );

  // Tx 11: Finalize Match
  await recordTx(
    11,
    'Finalize Match Outcome',
    registry.finalize(matchId, { gasPrice }),
    `Evaluated moves deterministically on-chain: Rock beats Scissors. Player 1 declared winner.`
  );

  // Tx 12: Trigger Settler on BOT Chain
  await recordTx(
    12,
    'Settle Prize on BotChainSettler',
    settler.settleMatch(tournamentId, matchId, { gasPrice }),
    `BotChainSettler verified on-chain result registry and unlocked PrizeVault policy to CLAIMABLE.`
  );

  // Tx 13: Claim Prize for Winner
  await recordTx(
    13,
    'Claim Prize to Winner',
    vault.claimFor(tournamentId, { gasPrice }),
    `Permissionless claim triggered: 100 PRIZE automatically disbursed from PrizeVault to winner (${deployerAddress}).`
  );

  console.log('\n======================================================');
  console.log('ALL 13 ON-CHAIN INTERACTIONS COMPLETED SUCCESSFULLY!');
  console.log('======================================================\n');

  // Write interaction report
  const docPath = path.join(root, 'docs', 'ON-CHAIN-INTERACTION-RECORDS.md');
  let md = `# BOT Chain On-Chain Interaction Records

**Network**: BOT Chain Testnet (Chain ID \`968\`)  
**RPC URL**: \`https://rpc.bohr.life\`  
**Explorer**: [scan.bohr.life](https://scan.bohr.life)  
**Primary Account**: [\`${deployerAddress}\`](https://scan.bohr.life/address/${deployerAddress})  
**Recorded Timestamp**: ${new Date().toISOString()}  

---

## Smart Contract Architecture on BOT Chain

| Contract | Address | Explorer Link |
| :--- | :--- | :--- |
| **BotChainSettler** | \`${SETTLER_ADDR}\` | [View on Explorer](https://scan.bohr.life/address/${SETTLER_ADDR}) |
| **PrizeVault** | \`${VAULT_ADDR}\` | [View on Explorer](https://scan.bohr.life/address/${VAULT_ADDR}) |
| **TournamentResultRegistry** | \`${REGISTRY_ADDR}\` | [View on Explorer](https://scan.bohr.life/address/${REGISTRY_ADDR}) |
| **MockPrizeToken (PRIZE)** | \`${TOKEN_ADDR}\` | [View on Explorer](https://scan.bohr.life/address/${TOKEN_ADDR}) |

---

## Contract Deployment Transactions

| Contract | Transaction Hash | Block | Status |
| :--- | :--- | :--- | :--- |
| **TournamentResultRegistry** | [\`0x54998055a853a126c4c9a7f35a15e313bc50c127d542649ed95777db16907100\`](https://scan.bohr.life/tx/0x54998055a853a126c4c9a7f35a15e313bc50c127d542649ed95777db16907100) | 27531122 | Confirmed (Success) |
| **MockPrizeToken (PRIZE)** | [\`0x685baaa9a82a343635088a627a59e48b737cb29593e4f4f50a305e9f97526875\`](https://scan.bohr.life/tx/0x685baaa9a82a343635088a627a59e48b737cb29593e4f4f50a305e9f97526875) | 27531134 | Confirmed (Success) |
| **PrizeVault** | [\`0x63aab24b3a02d8bf62b993753278daf4953fce0aa1df6e58119ddfea7b30b045\`](https://scan.bohr.life/tx/0x63aab24b3a02d8bf62b993753278daf4953fce0aa1df6e58119ddfea7b30b045) | 27531139 | Confirmed (Success) |
| **BotChainSettler** | [\`0xd14c3d0a7a62ee4491e1f86be26782e27cb7c4a535381d89f75a92406911600d\`](https://scan.bohr.life/tx/0xd14c3d0a7a62ee4491e1f86be26782e27cb7c4a535381d89f75a92406911600d) | 27531145 | Confirmed (Success) |

---

## Live End-to-End Tournament Lifecycle Interactions

The following 13 transactions demonstrate a complete, verifiable decentralized tournament lifecycle on BOT Chain: from player onboarding and prize token escrow, through cryptographic move commitments and on-chain outcome derivation, to autonomous settlement and winner payout.

| Step | Action | Transaction Hash | Block | Gas Used | Details |
| :---: | :--- | :--- | :---: | :---: | :--- |
`;

  for (const r of txRecords) {
    md += `| **${r.step}** | **${r.action}** | [\`${r.txHash.slice(0, 18)}...\`](${r.explorerUrl}) | ${r.blockNumber} | ${r.gasUsed} | ${r.description} |\n`;
  }

  md += `\n---

## Direct Explorer Verification
All transactions can be independently inspected and verified on the official BOT Chain Testnet explorer:
- **Wallet Overview**: https://scan.bohr.life/address/${deployerAddress}
- **Tournament Settler Contract**: https://scan.bohr.life/address/${SETTLER_ADDR}
- **Prize Escrow Vault**: https://scan.bohr.life/address/${VAULT_ADDR}
`;

  fs.writeFileSync(docPath, md);
  console.log(`Report generated at: ${docPath}`);

  // Also save json summary
  fs.writeFileSync(
    path.join(root, 'evidence', `botchain-interactions-${Date.now()}.json`),
    JSON.stringify({ deployer: deployerAddress, txRecords }, null, 2)
  );
}

main().catch((err) => {
  console.error('Interaction sequence failed:', err);
  process.exit(1);
});
