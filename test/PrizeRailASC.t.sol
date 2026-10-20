// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PrizeRailASC} from "../contracts/creditcoin/PrizeRailASC.sol";
import {PrizeVault} from "../contracts/creditcoin/PrizeVault.sol";
import {MockPrizeToken} from "../contracts/test/MockPrizeToken.sol";
import {MockNativeQueryVerifier, RejectingNativeQueryVerifier} from "../contracts/test/MockNativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

contract PrizeRailASCTest is Test {
    address constant PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    PrizeRailASC asc;
    PrizeVault vault;
    MockPrizeToken token;
    address organizer = address(0xA1);
    address playerTwo = address(0xB2);
    address registry = address(0xC3);
    bytes32 tournamentId = keccak256("asc-tournament");
    bytes32 matchId = keccak256("asc-match");
    bytes32 rulesHash = keccak256("rps-v1");
    uint256 resultNonce;
    bytes32 constant EVENT_SIGNATURE = keccak256("MatchFinalized(bytes32,bytes32,address,address,address,uint8,bytes32,uint256,uint8,uint64,uint64,uint64)");

    function setUp() public {
        MockNativeQueryVerifier verifier = new MockNativeQueryVerifier();
        vm.etch(PRECOMPILE, address(verifier).code);
        address predictedAsc = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        vault = new PrizeVault(predictedAsc);
        asc = new PrizeRailASC(address(vault), 1);
        token = new MockPrizeToken();
        resultNonce = uint256(keccak256(abi.encode(matchId)));
        token.mint(organizer, 10 ether);
        vm.prank(organizer); vault.createTournament(tournamentId, organizer, 1, registry, rulesHash, address(token), 10 ether, uint64(block.timestamp + 100), uint64(block.timestamp + 200));
        vm.prank(organizer); token.approve(address(vault), 10 ether);
        vm.prank(organizer); vault.fund(tournamentId);
    }

    function testVerifySettleReplayAndPayout() public {
        asc.verifyAndSettle(0, 1, 10, _encoded(tournamentId, registry, rulesHash, organizer, 1, resultNonce, 0, 11155111), bytes32(0), _siblings(), bytes32(0), _roots());
        (,,,,,,,,address winner,,bytes32 queryKey,PrizeVault.State state) = vault.policies(tournamentId);
        assertEq(winner, organizer);
        assertTrue(queryKey != bytes32(0));
        assertEq(uint8(state), uint8(PrizeVault.State.CLAIMABLE));
        vm.expectRevert(PrizeRailASC.ReplaySource.selector);
        asc.verifyAndSettle(0, 1, 10, _encoded(tournamentId, registry, rulesHash, organizer, 1, resultNonce, 0, 11155111), bytes32(0), _siblings(), bytes32(0), _roots());
        vm.prank(playerTwo); vault.claimFor(tournamentId);
        assertEq(token.balanceOf(organizer), 10 ether);
    }

    function testBusinessReplayWithDifferentSourceQueryReverts() public {
        asc.verifyAndSettle(0, 1, 10, _encoded(tournamentId, registry, rulesHash, organizer, 1, resultNonce, 0, 11155111), bytes32(0), _siblings(), bytes32(0), _roots());
        vm.expectRevert(PrizeRailASC.ReplayBusiness.selector);
        asc.verifyAndSettle(0, 1, 11, _encodedWithNonce(1, EVENT_SIGNATURE, tournamentId, registry, rulesHash, organizer, 1, resultNonce, 0, 11155111, 1), bytes32(uint256(1)), _siblings(), bytes32(0), _roots());
    }

    function testSemanticFailures() public {
        vm.expectRevert(PrizeRailASC.WrongChain.selector); asc.verifyAndSettle(0, 2, 10, _encoded(tournamentId, registry, rulesHash, organizer, 1, resultNonce, 0, 11155111), bytes32(0), _siblings(), bytes32(0), _roots());
        vm.expectRevert(PrizeRailASC.WrongSource.selector); asc.verifyAndSettle(0, 1, 10, _encoded(tournamentId, address(0xBAD), rulesHash, organizer, 1, resultNonce, 0, 11155111), bytes32(uint256(1)), _siblings(), bytes32(0), _roots());
        vm.expectRevert(PrizeRailASC.WrongRules.selector); asc.verifyAndSettle(0, 1, 10, _encoded(tournamentId, registry, bytes32(uint256(2)), organizer, 1, resultNonce, 0, 11155111), bytes32(uint256(2)), _siblings(), bytes32(0), _roots());
        vm.expectRevert(PrizeRailASC.WrongWinner.selector); asc.verifyAndSettle(0, 1, 10, _encoded(tournamentId, registry, rulesHash, playerTwo, 1, resultNonce, 0, 11155111), bytes32(uint256(3)), _siblings(), bytes32(0), _roots());
        vm.expectRevert(PrizeRailASC.InvalidFinalization.selector); asc.verifyAndSettle(0, 1, 10, _encoded(tournamentId, registry, rulesHash, organizer, 1, resultNonce + 1, 0, 11155111), bytes32(uint256(4)), _siblings(), bytes32(0), _roots());
        vm.expectRevert(PrizeRailASC.InvalidFinalization.selector); asc.verifyAndSettle(0, 1, 10, _encoded(tournamentId, registry, rulesHash, organizer, 1, resultNonce, 2, 11155111), bytes32(uint256(5)), _siblings(), bytes32(0), _roots());
        vm.expectRevert(PrizeRailASC.WrongChain.selector); asc.verifyAndSettle(0, 1, 10, _encoded(tournamentId, registry, rulesHash, organizer, 1, resultNonce, 0, 1), bytes32(uint256(6)), _siblings(), bytes32(0), _roots());
    }

    function testInvalidProofReverts() public {
        RejectingNativeQueryVerifier verifier = new RejectingNativeQueryVerifier();
        vm.etch(PRECOMPILE, address(verifier).code);
        vm.expectRevert(PrizeRailASC.FailedReceipt.selector);
        asc.verifyAndSettle(0, 1, 10, _encoded(tournamentId, registry, rulesHash, organizer, 1, resultNonce, 0, 11155111), bytes32(0), _siblings(), bytes32(0), _roots());
    }

    function testReceiptAndWrongEventRevert() public {
        vm.expectRevert(PrizeRailASC.FailedReceipt.selector);
        asc.verifyAndSettle(0, 1, 10, _encodedWith(0, EVENT_SIGNATURE, tournamentId, registry, rulesHash, organizer, 1, resultNonce, 0, 11155111), bytes32(0), _siblings(), bytes32(0), _roots());
        vm.expectRevert(PrizeRailASC.MissingEvent.selector);
        asc.verifyAndSettle(0, 1, 10, _encodedWith(1, bytes32(uint256(123)), tournamentId, registry, rulesHash, organizer, 1, resultNonce, 0, 11155111), bytes32(uint256(1)), _siblings(), bytes32(0), _roots());
    }

    function testProofCannotSettleAfterNormalRefund() public {
        bytes memory encoded = _encoded(tournamentId, registry, rulesHash, organizer, 1, resultNonce, 0, 11155111);
        vm.warp(block.timestamp + 101);
        vm.prank(organizer); vault.refund(tournamentId);
        vm.expectRevert(PrizeRailASC.Expired.selector);
        asc.verifyAndSettle(0, 1, 10, encoded, bytes32(0), _siblings(), bytes32(0), _roots());
        assertFalse(asc.usedSourceQueries(keccak256(encoded)));
    }

    function testProofCannotSettleAfterExpiredRecovery() public {
        bytes memory encoded = _encoded(tournamentId, registry, rulesHash, organizer, 1, resultNonce, 0, 11155111);
        vm.warp(block.timestamp + 201);
        vault.recoverExpired(tournamentId);
        vm.expectRevert(PrizeRailASC.Expired.selector);
        asc.verifyAndSettle(0, 1, 10, encoded, bytes32(0), _siblings(), bytes32(0), _roots());
        assertFalse(asc.usedSourceQueries(keccak256(encoded)));
    }

    function _encoded(bytes32 id, address emitter, bytes32 rules, address winner, uint8 result, uint256 nonce, uint8 status, uint64 sourceChainId) internal view returns (bytes memory) {
        return _encodedWithNonce(1, EVENT_SIGNATURE, id, emitter, rules, winner, result, nonce, status, sourceChainId, 0);
    }

    function _encodedWith(uint8 receiptStatus, bytes32 eventSignature, bytes32 id, address emitter, bytes32 rules, address winner, uint8 result, uint256 nonce, uint8 status, uint64 sourceChainId) internal view returns (bytes memory) {
        return _encodedWithNonce(receiptStatus, eventSignature, id, emitter, rules, winner, result, nonce, status, sourceChainId, 0);
    }

    function _encodedWithNonce(uint8 receiptStatus, bytes32 eventSignature, bytes32 id, address emitter, bytes32 rules, address winner, uint8 result, uint256 nonce, uint8 status, uint64 sourceChainId, uint64 txNonce) internal view returns (bytes memory) {
        bytes32[] memory topics = new bytes32[](2); topics[0] = eventSignature; topics[1] = id;
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](1);
        logs[0] = EvmV1Decoder.LogEntryTuple({address_: emitter, topics: topics, data: abi.encode(matchId, organizer, playerTwo, winner, result, rules, nonce, status, sourceChainId, uint64(10), uint64(100))});
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(txNonce, uint64(21000), organizer, false, emitter, uint256(0), bytes(""));
        chunks[1] = abi.encode(uint128(1), uint256(27), bytes32(0), bytes32(0));
        chunks[2] = abi.encode(receiptStatus, uint64(21000), logs, bytes(""));
        return abi.encode(uint8(0), chunks);
    }

    function _siblings() internal pure returns (INativeQueryVerifier.MerkleProofEntry[] memory entries) { entries = new INativeQueryVerifier.MerkleProofEntry[](0); }
    function _roots() internal pure returns (bytes32[] memory roots) { roots = new bytes32[](0); }
}
