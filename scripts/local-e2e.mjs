import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ContractFactory, JsonRpcProvider, AbiCoder, keccak256, toBeHex, getCreateAddress, parseEther } from 'ethers';
import { safeError } from './safe-error.mjs';

const root = process.cwd();
const port = 24000 + Math.floor(Math.random() * 1000);
const rpcUrl = `http://127.0.0.1:${port}`;
const anvil = spawn('anvil', ['--silent', '--chain-id', '11155111', '--port', String(port)], { stdio: 'ignore' });
const stop = () => { if (!anvil.killed) anvil.kill('SIGTERM'); };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });
process.on('SIGTERM', () => { stop(); process.exit(143); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ready = false;
for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    const probe = new JsonRpcProvider(rpcUrl, 11155111, { staticNetwork: true });
    if (await probe.send('eth_chainId', [])) { ready = true; break; }
  } catch {}
  await sleep(200);
}
if (!ready) { stop(); throw new Error(`Anvil did not become ready on ${rpcUrl}`); }

const provider = new JsonRpcProvider(rpcUrl, 11155111, { staticNetwork: true });
const deployer = await provider.getSigner(0);
const organizer = await provider.getSigner(1);
const winner = await provider.getSigner(2);
const deployerAddress = await deployer.getAddress();
const organizerAddress = await organizer.getAddress();
const winnerAddress = await winner.getAddress();

function artifact(name) { return JSON.parse(fs.readFileSync(path.join(root, 'artifacts', `${name}.json`), 'utf8')); }
async function deploy(name, signer, args = []) {
  const a = artifact(name);
  const c = await new ContractFactory(a.abi, a.bytecode, signer).deploy(...args);
  await c.waitForDeployment();
  return c;
}
async function tx(contract, method, args = []) { const sent = await contract[method](...args); const receipt = await sent.wait(); return { hash: sent.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() }; }
async function expectRevert(label, fn) {
  try {
    const outcome = await fn();
    if (typeof outcome?.wait === 'function') await outcome.wait();
    assert.fail(`${label} unexpectedly succeeded`);
  } catch (error) {
    if (String(error?.message ?? '').includes('unexpectedly succeeded')) throw error;
    return { label, rejected: true, error: safeError(error) };
  }
}

const registry = await deploy('TournamentResultRegistry', deployer, [deployerAddress]);
const token = await deploy('MockPrizeToken', deployer);
const nonce = await provider.getTransactionCount(deployerAddress);
const ascAddress = getCreateAddress({ from: deployerAddress, nonce: nonce + 1 });
const vault = await deploy('PrizeVault', deployer, [ascAddress]);
const asc = await deploy('PrizeRailASC', deployer, [await vault.getAddress(), 1]);
const verifier = await deploy('MockNativeQueryVerifier', deployer);
const verifierCode = await provider.getCode(await verifier.getAddress());
await provider.send('anvil_setCode', ['0x0000000000000000000000000000000000000FD2', verifierCode]);

const abi = AbiCoder.defaultAbiCoder();
const tournamentId = keccak256(Buffer.from('prizerail-local-tournament'));
const matchId = keccak256(Buffer.from('prizerail-local-match'));
const rulesHash = keccak256(Buffer.from('rps-v1'));
const latest = await provider.getBlock('latest');
const deadline = Number(latest.timestamp) + 3600;
const amount = parseEther('10');

await tx(token, 'mint', [organizerAddress, amount]);
await tx(vault.connect(organizer), 'createTournament', [tournamentId, organizerAddress, 1, await registry.getAddress(), rulesHash, await token.getAddress(), amount, deadline, deadline + 3600]);
await tx(token.connect(organizer), 'approve', [await vault.getAddress(), amount]);
const funded = await tx(vault.connect(organizer), 'fund', [tournamentId]);

await tx(registry, 'createMatch', [tournamentId, matchId, organizerAddress, winnerAddress, rulesHash, deadline]);
const saltOne = keccak256(Buffer.from('salt-one'));
const saltTwo = keccak256(Buffer.from('salt-two'));
const commit = (choice, salt) => keccak256(abi.encode(['uint8', 'bytes32'], [choice, salt]));
await tx(registry.connect(organizer), 'commit', [matchId, commit(1, saltOne)]);
await tx(registry.connect(winner), 'commit', [matchId, commit(3, saltTwo)]);
await tx(registry.connect(organizer), 'reveal', [matchId, 1, saltOne]);
await tx(registry.connect(winner), 'reveal', [matchId, 3, saltTwo]);
const finalized = await tx(registry, 'finalize', [matchId]);
const result = await registry.matches(matchId);
const sourceChainId = await registry.sourceChainId();
assert.equal(result.winner.toLowerCase(), organizerAddress.toLowerCase());

const eventTopic = keccak256(Buffer.from('MatchFinalized(bytes32,bytes32,address,address,address,uint8,bytes32,uint256,uint8,uint64,uint64,uint64)'));
async function encodeEvent({ eventTournamentId = tournamentId, eventSignature = eventTopic, eventMatchId = matchId, eventPlayerOne = organizerAddress, eventPlayerTwo = winnerAddress, eventWinner = result.winner, eventResult = result.result, eventRulesHash = rulesHash, eventResultNonce = result.resultNonce, eventStatus = result.status, eventSourceChainId = sourceChainId, eventFinalizedAt = result.finalizedAt, eventDeadline = result.revealDeadline, emitter } = {}) {
  emitter ??= await registry.getAddress();
  const topic = [eventSignature, eventTournamentId];
  const data = abi.encode(
    ['bytes32', 'address', 'address', 'address', 'uint8', 'bytes32', 'uint256', 'uint8', 'uint64', 'uint64', 'uint64'],
    [eventMatchId, eventPlayerOne, eventPlayerTwo, eventWinner, eventResult, eventRulesHash, eventResultNonce, eventStatus, eventSourceChainId, eventFinalizedAt, eventDeadline],
  );
  return abi.encode(['uint8', 'bytes[]'], [0, [
    abi.encode(['uint64', 'uint64', 'address', 'bool', 'address', 'uint256', 'bytes'], [0, 21000, deployerAddress, false, emitter, 0, '0x']),
    abi.encode(['uint128', 'uint256', 'bytes32', 'bytes32'], [1, 27, toBeHex(0, 32), toBeHex(0, 32)]),
    abi.encode(['uint8', 'uint64', 'tuple(address,bytes32[],bytes)[]', 'bytes'], [1, 21000, [[emitter, topic, data]], '0x']),
  ]]);
}
async function encodeEventWithTxNonce(txNonce) {
  const emitter = await registry.getAddress();
  const topic = [eventTopic, tournamentId];
  const data = abi.encode(['bytes32', 'address', 'address', 'address', 'uint8', 'bytes32', 'uint256', 'uint8', 'uint64', 'uint64', 'uint64'], [matchId, organizerAddress, winnerAddress, result.winner, result.result, rulesHash, result.resultNonce, result.status, sourceChainId, result.finalizedAt, result.revealDeadline]);
  return abi.encode(['uint8', 'bytes[]'], [0, [abi.encode(['uint64', 'uint64', 'address', 'bool', 'address', 'uint256', 'bytes'], [txNonce, 21000, deployerAddress, false, emitter, 0, '0x']), abi.encode(['uint128', 'uint256', 'bytes32', 'bytes32'], [1, 27, toBeHex(0, 32), toBeHex(0, 32)]), abi.encode(['uint8', 'uint64', 'tuple(address,bytes32[],bytes)[]', 'bytes'], [1, 21000, [[emitter, topic, data]], '0x'])]]);
}
const encoded = await encodeEvent();
const proofArgs = [0, 1, 1, encoded, toBeHex(0, 32), [], toBeHex(0, 32), []];
const settled = await tx(asc, 'verifyAndSettle', proofArgs);
const policy = await vault.policies(tournamentId);
assert.equal(Number(policy.state), 2);
const claimed = await tx(vault.connect(winner), 'claimFor', [tournamentId]);
assert.equal((await token.balanceOf(organizerAddress)).toString(), amount.toString());
const replay = await expectRevert('same source transaction/business result', () => asc.verifyAndSettle(...proofArgs));
const businessReplay = await expectRevert('same business result with different source transaction', async () => asc.verifyAndSettle(0, 1, 99, await encodeEventWithTxNonce(1), toBeHex(100, 32), [], toBeHex(0, 32), []));
const wrongChain = await expectRevert('wrong source chain key', () => asc.verifyAndSettle(0, 2, ...proofArgs.slice(2)));
const wrongSource = await expectRevert('wrong source result contract', async () => asc.verifyAndSettle(0, 1, 1, await encodeEvent({ emitter: winnerAddress }), toBeHex(2, 32), [], toBeHex(0, 32), []));
const wrongEvent = await expectRevert('wrong event signature', async () => asc.verifyAndSettle(0, 1, 1, await encodeEvent({ eventSignature: toBeHex(999, 32) }), toBeHex(3, 32), [], toBeHex(0, 32), []));
const wrongTournament = await expectRevert('wrong tournament ID', async () => asc.verifyAndSettle(0, 1, 1, await encodeEvent({ eventTournamentId: keccak256(Buffer.from('unknown-tournament')) }), toBeHex(4, 32), [], toBeHex(0, 32), []));
const wrongRules = await expectRevert('wrong rules hash', async () => asc.verifyAndSettle(0, 1, 1, await encodeEvent({ eventRulesHash: keccak256(Buffer.from('wrong-rules')) }), toBeHex(5, 32), [], toBeHex(0, 32), []));
const wrongWinner = await expectRevert('wrong winner semantic payload', async () => {
  const badEncoded = await encodeEvent({ eventWinner: winnerAddress, eventResultNonce: result.resultNonce });
  await asc.verifyAndSettle(0, 1, 1, badEncoded, toBeHex(6, 32), [], toBeHex(0, 32), []);
});
const wrongNonce = await expectRevert('zero result nonce', async () => asc.verifyAndSettle(0, 1, 1, await encodeEvent({ eventResultNonce: 0 }), toBeHex(7, 32), [], toBeHex(0, 32), []));
const invalidFinalization = await expectRevert('invalid finalization state', async () => asc.verifyAndSettle(0, 1, 1, await encodeEvent({ eventStatus: 2 }), toBeHex(8, 32), [], toBeHex(0, 32), []));
const unfundedId = keccak256(Buffer.from('unfunded'));
await tx(vault.connect(organizer), 'createTournament', [unfundedId, organizerAddress, 1, await registry.getAddress(), rulesHash, await token.getAddress(), amount, deadline, deadline + 3600]);
const unfunded = await expectRevert('unfunded tournament', async () => asc.verifyAndSettle(0, 1, 1, await encodeEvent({ eventTournamentId: unfundedId }), toBeHex(9, 32), [], toBeHex(0, 32), []));
const unauthorizedSettlement = await expectRevert('unauthorized settlement', () => vault.connect(winner).settle(tournamentId, winnerAddress, 1, toBeHex(123, 32)));
const doublePayout = await expectRevert('double payout', () => vault.connect(winner).claimFor(tournamentId));

const drawMatchId = keccak256(Buffer.from('draw-match'));
const nowForSource = Number((await provider.getBlock('latest')).timestamp);
const drawDeadline = nowForSource + 1000;
await tx(registry, 'createMatch', [keccak256(Buffer.from('draw-tournament')), drawMatchId, organizerAddress, winnerAddress, rulesHash, drawDeadline]);
const drawSaltOne = keccak256(Buffer.from('draw-one'));
const drawSaltTwo = keccak256(Buffer.from('draw-two'));
await tx(registry.connect(organizer), 'commit', [drawMatchId, commit(1, drawSaltOne)]);
await tx(registry.connect(winner), 'commit', [drawMatchId, commit(1, drawSaltTwo)]);
await tx(registry.connect(organizer), 'reveal', [drawMatchId, 1, drawSaltOne]);
await tx(registry.connect(winner), 'reveal', [drawMatchId, 1, drawSaltTwo]);
await tx(registry, 'finalize', [drawMatchId]);
const drawResult = await registry.matches(drawMatchId);
assert.equal(drawResult.winner, '0x0000000000000000000000000000000000000000');
const alreadyFinalized = await expectRevert('already finalized source match', () => registry.finalize(drawMatchId));

const invalidRevealMatchId = keccak256(Buffer.from('invalid-reveal-match'));
await tx(registry, 'createMatch', [keccak256(Buffer.from('invalid-reveal-tournament')), invalidRevealMatchId, organizerAddress, winnerAddress, rulesHash, drawDeadline]);
await tx(registry.connect(organizer), 'commit', [invalidRevealMatchId, commit(1, drawSaltOne)]);
const invalidReveal = await expectRevert('invalid or missing reveal', () => registry.connect(organizer).reveal(invalidRevealMatchId, 1, drawSaltTwo));

const timeoutMatchId = keccak256(Buffer.from('timeout-match'));
const timeoutDeadline = Number((await provider.getBlock('latest')).timestamp) + 5;
await tx(registry, 'createMatch', [keccak256(Buffer.from('timeout-tournament')), timeoutMatchId, organizerAddress, winnerAddress, rulesHash, timeoutDeadline]);
await tx(registry.connect(organizer), 'commit', [timeoutMatchId, commit(1, drawSaltOne)]);
await tx(registry.connect(organizer), 'reveal', [timeoutMatchId, 1, drawSaltOne]);
await provider.send('evm_increaseTime', [10]);
await provider.send('evm_mine', []);
await tx(registry, 'finalize', [timeoutMatchId]);
const timeoutResult = await registry.matches(timeoutMatchId);
assert.equal(Number(timeoutResult.result), 3);

const expiredId = keccak256(Buffer.from('expired-tournament'));
const expiredNow = Number((await provider.getBlock('latest')).timestamp);
const expiredSettlementDeadline = expiredNow + 5;
const expiredRefundDeadline = expiredNow + 1000;
await tx(token, 'mint', [organizerAddress, amount]);
await tx(vault.connect(organizer), 'createTournament', [expiredId, organizerAddress, 1, await registry.getAddress(), rulesHash, await token.getAddress(), amount, expiredSettlementDeadline, expiredRefundDeadline]);
await tx(token.connect(organizer), 'approve', [await vault.getAddress(), amount]);
await tx(vault.connect(organizer), 'fund', [expiredId]);
await provider.send('evm_increaseTime', [10]);
await provider.send('evm_mine', []);
const expired = await expectRevert('expired result', async () => asc.verifyAndSettle(0, 1, 1, await encodeEvent({ eventTournamentId: expiredId }), toBeHex(10, 32), [], toBeHex(0, 32), []));
const unauthorizedRefund = await expectRevert('unauthorized refund', () => vault.connect(winner).refund(expiredId));
const refunded = await tx(vault.connect(organizer), 'refund', [expiredId]);

const rejecting = await deploy('RejectingNativeQueryVerifier', deployer);
await provider.send('anvil_setCode', ['0x0000000000000000000000000000000000000FD2', await provider.getCode(await rejecting.getAddress())]);
const invalidProof = await expectRevert('invalid proof', () => asc.verifyAndSettle(0, 1, 1, encoded, toBeHex(11, 32), [], toBeHex(0, 32), []));

const evidence = { runId: 'local-anvil-1', mode: 'local-verifier-double', chainId: 11155111, contracts: { registry: await registry.getAddress(), vault: await vault.getAddress(), asc: await asc.getAddress(), token: await token.getAddress() }, tournamentId, matchId, rulesHash, winner: result.winner, source: { ...finalized, decodedResult: Number(result.result), resultNonce: result.resultNonce.toString() }, settlement: settled, payout: claimed, replay, businessReplay, wrongChain, wrongSource, wrongEvent, wrongTournament, wrongRules, wrongWinner, wrongNonce, invalidFinalization, unfunded, unauthorizedSettlement, doublePayout, draw: { matchId: drawMatchId, winner: drawResult.winner }, alreadyFinalized, invalidReveal, timeout: { matchId: timeoutMatchId, result: Number(timeoutResult.result), winner: timeoutResult.winner }, expired, unauthorizedRefund, refunded, invalidProof };
fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
fs.writeFileSync(path.join(root, 'evidence', 'local-e2e-run-1.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
stop();
