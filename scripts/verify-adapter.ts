import assert from 'node:assert/strict';
import { AbiCoder, Interface, keccak256, toUtf8Bytes } from 'ethers';
import { rpsMatchFinalizedAdapter } from '../src/adapter.js';

const sourceContract = '0x83Dfc7fbbd949441Cdc7f8b1eD2D916d059e764D';
const playerOne = '0x00000000000000000000000000000000000000A1';
const playerTwo = '0x00000000000000000000000000000000000000B2';
const tournamentId = keccak256(toUtf8Bytes('adapter-tournament'));
const matchId = keccak256(toUtf8Bytes('adapter-match'));
const rulesHash = keccak256(toUtf8Bytes('prizerail-rps-v1'));
const resultNonce = BigInt(keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32'], [matchId])));
const eventInterface = new Interface([
  'event MatchFinalized(bytes32 indexed tournamentId,bytes32 matchId,address playerOne,address playerTwo,address winner,uint8 result,bytes32 rulesHash,uint256 resultNonce,uint8 finalizationStatus,uint64 sourceChainId,uint64 finalizedAt,uint64 deadline)',
]);
const event = eventInterface.getEvent('MatchFinalized');
if (!event) throw new Error('MatchFinalized event fragment missing');
const encoded = eventInterface.encodeEventLog(event, [tournamentId, matchId, playerOne, playerTwo, playerOne, 1, rulesHash, resultNonce, 0, 11155111, 1_788_980_000, 1_788_981_800]);
const receipt = { status: 1, logs: [{ address: sourceContract, topics: encoded.topics, data: encoded.data }] };
const result = rpsMatchFinalizedAdapter.decode(receipt, sourceContract);

assert.equal(result.tournamentId, tournamentId);
assert.equal(result.matchId, matchId);
assert.equal(result.winner.toLowerCase(), playerOne.toLowerCase());
assert.equal(result.rulesHash, rulesHash);
assert.equal(result.resultNonce, resultNonce.toString());
assert.equal(result.sourceChainId, '11155111');
assert.equal(rpsMatchFinalizedAdapter.businessKey(result), `${tournamentId}:${resultNonce}`);
assert.throws(() => rpsMatchFinalizedAdapter.decode({ ...receipt, status: 0 }, sourceContract), /not successful/);
assert.throws(() => rpsMatchFinalizedAdapter.decode(receipt, '0x0000000000000000000000000000000000000001'), /not found/);

console.log(JSON.stringify({ adapter: rpsMatchFinalizedAdapter.name, eventSignature: rpsMatchFinalizedAdapter.eventSignature, verified: true }, null, 2));
