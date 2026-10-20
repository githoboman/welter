import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

const root = process.cwd();
const entries = [
  'contracts/source/TournamentResultRegistry.sol',
  'contracts/creditcoin/PrizeVault.sol',
  'contracts/creditcoin/PrizeRailASC.sol',
  'contracts/botchain/BotChainSettler.sol',
  'contracts/test/MockPrizeToken.sol',
  'contracts/test/MockNativeQueryVerifier.sol',
];

function resolveImport(importPath) {
  const candidates = [
    path.join(root, importPath),
    path.join(root, 'lib', 'asc-contracts', importPath),
    path.join(root, 'lib', 'openzeppelin-contracts', importPath),
    path.join(root, 'lib', 'forge-std', importPath),
    importPath.startsWith('@gluwa/') ? path.join(root, 'lib', 'asc-contracts', importPath.replace('@gluwa/asc-contracts/', '')) : '',
    importPath.startsWith('@openzeppelin/contracts/') ? path.join(root, 'lib', 'openzeppelin-contracts', importPath.replace('@openzeppelin/contracts/', '')) : '',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { contents: fs.readFileSync(candidate, 'utf8') };
  }
  return { error: `File not found: ${importPath}` };
}

const input = {
  language: 'Solidity',
  sources: Object.fromEntries(entries.map((file) => [file, { content: fs.readFileSync(path.join(root, file), 'utf8') }])),
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
for (const error of output.errors ?? []) console.error(error.formattedMessage);
if ((output.errors ?? []).some((error) => error.severity === 'error')) process.exit(1);
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
for (const [source, contracts] of Object.entries(output.contracts ?? {})) {
  for (const [name, artifact] of Object.entries(contracts)) {
    fs.writeFileSync(path.join(root, 'artifacts', `${name}.json`), JSON.stringify({ contractName: name, sourceName: source, abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, deployedBytecode: `0x${artifact.evm.deployedBytecode.object}` }, null, 2));
  }
}
console.log(`compiled ${Object.values(output.contracts ?? {}).reduce((n, group) => n + Object.keys(group).length, 0)} contracts`);
