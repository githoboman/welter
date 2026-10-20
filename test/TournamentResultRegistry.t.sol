// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TournamentResultRegistry} from "../contracts/source/TournamentResultRegistry.sol";

contract TournamentResultRegistryTest is Test {
    TournamentResultRegistry registry;
    address playerOne = address(0xA1);
    address playerTwo = address(0xB2);
    bytes32 rulesHash = keccak256("rps-v1");

    function setUp() public { registry = new TournamentResultRegistry(address(this)); }

    function testFinalizerCannotChooseWinnerAndAlreadyFinalized() public {
        bytes32 matchId = keccak256("normal");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        registry.createMatch(keccak256("tournament"), matchId, playerOne, playerTwo, rulesHash, deadline);
        _play(matchId, 1, 3);
        registry.finalize(matchId);
        (bytes32 ignoredTournament, bytes32 ignoredMatch, address ignoredOne, address ignoredTwo, bytes32 ignoredRules, uint64 ignoredDeadline, bytes32 ignoredCommitOne, bytes32 ignoredCommitTwo, TournamentResultRegistry.Choice ignoredChoiceOne, TournamentResultRegistry.Choice ignoredChoiceTwo, bool ignoredRevealedOne, bool ignoredRevealedTwo, bool finalized, address winner, TournamentResultRegistry.Result result, TournamentResultRegistry.FinalizationStatus status, uint256 nonce, uint64 ignoredFinalizedAt) = registry.matches(matchId);
        ignoredTournament; ignoredMatch; ignoredOne; ignoredTwo; ignoredRules; ignoredDeadline; ignoredCommitOne; ignoredCommitTwo; ignoredChoiceOne; ignoredChoiceTwo; ignoredRevealedOne; ignoredRevealedTwo; ignoredFinalizedAt;
        assertTrue(finalized);
        assertEq(winner, playerOne);
        assertEq(uint8(result), uint8(TournamentResultRegistry.Result.PlayerOneWin));
        assertEq(uint8(status), uint8(TournamentResultRegistry.FinalizationStatus.Normal));
        assertEq(nonce, uint256(keccak256(abi.encode(matchId))));
        vm.expectRevert(TournamentResultRegistry.InvalidState.selector);
        registry.finalize(matchId);
    }

    function testFinalizerAsPlayerStillCannotOverrideDerivedWinner() public {
        bytes32 matchId = keccak256("finalizer-player");
        address finalizerPlayer = address(this);
        registry.createMatch(keccak256("tournament-finalizer-player"), matchId, finalizerPlayer, playerTwo, rulesHash, uint64(block.timestamp + 1 hours));
        bytes32 saltOne = keccak256("finalizer-one");
        bytes32 saltTwo = keccak256("finalizer-two");
        registry.commit(matchId, keccak256(abi.encode(uint8(1), saltOne)));
        vm.prank(playerTwo); registry.commit(matchId, keccak256(abi.encode(uint8(2), saltTwo)));
        registry.reveal(matchId, 1, saltOne);
        vm.prank(playerTwo); registry.reveal(matchId, 2, saltTwo);
        registry.finalize(matchId);
        (,,,,,,,,,,,,,address winner,TournamentResultRegistry.Result result,,,) = registry.matches(matchId);
        assertEq(winner, playerTwo);
        assertEq(uint8(result), uint8(TournamentResultRegistry.Result.PlayerTwoWin));
    }

    function testNormalLoss() public {
        bytes32 matchId = keccak256("loss");
        registry.createMatch(keccak256("tournament-loss"), matchId, playerOne, playerTwo, rulesHash, uint64(block.timestamp + 1 hours));
        _play(matchId, 1, 2);
        registry.finalize(matchId);
        (,,,,,,,,,,,,,address winner,TournamentResultRegistry.Result result,,,) = registry.matches(matchId);
        assertEq(winner, playerTwo);
        assertEq(uint8(result), uint8(TournamentResultRegistry.Result.PlayerTwoWin));
    }

    function testDraw() public {
        bytes32 matchId = keccak256("draw");
        registry.createMatch(keccak256("tournament-draw"), matchId, playerOne, playerTwo, rulesHash, uint64(block.timestamp + 1 hours));
        _play(matchId, 1, 1);
        registry.finalize(matchId);
        (,,,,,,,,,,,,,address winner,TournamentResultRegistry.Result result,,,) = registry.matches(matchId);
        assertEq(winner, address(0));
        assertEq(uint8(result), uint8(TournamentResultRegistry.Result.Draw));
    }

    function testTimeoutAwardsOnlyRevealedPlayer() public {
        bytes32 matchId = keccak256("timeout");
        uint64 deadline = uint64(block.timestamp + 10);
        registry.createMatch(keccak256("tournament-timeout"), matchId, playerOne, playerTwo, rulesHash, deadline);
        bytes32 salt = keccak256("salt");
        vm.prank(playerOne); registry.commit(matchId, keccak256(abi.encode(uint8(1), salt)));
        vm.prank(playerTwo); registry.commit(matchId, keccak256(abi.encode(uint8(3), keccak256("unused-two"))));
        vm.prank(playerOne); registry.reveal(matchId, 1, salt);
        vm.warp(deadline + 1);
        registry.finalize(matchId);
        (,,,,,,,,,,,,,address winner,TournamentResultRegistry.Result result,TournamentResultRegistry.FinalizationStatus status,,) = registry.matches(matchId);
        assertEq(winner, playerOne);
        assertEq(uint8(result), uint8(TournamentResultRegistry.Result.TimeoutPlayerOneWin));
        assertEq(uint8(status), uint8(TournamentResultRegistry.FinalizationStatus.Timeout));
    }

    function testTimeoutWithNoRevealProducesDraw() public {
        bytes32 matchId = keccak256("timeout-draw");
        uint64 deadline = uint64(block.timestamp + 10);
        registry.createMatch(keccak256("tournament-timeout-draw"), matchId, playerOne, playerTwo, rulesHash, deadline);
        vm.warp(deadline + 1);
        registry.finalize(matchId);
        (,,,,,,,,,,,,,address winner,TournamentResultRegistry.Result result,TournamentResultRegistry.FinalizationStatus status,,) = registry.matches(matchId);
        assertEq(winner, address(0));
        assertEq(uint8(result), uint8(TournamentResultRegistry.Result.Draw));
        assertEq(uint8(status), uint8(TournamentResultRegistry.FinalizationStatus.Timeout));
    }

    function testInvalidRevealAndPrematureFinalizeRevert() public {
        bytes32 matchId = keccak256("invalid");
        registry.createMatch(keccak256("tournament-invalid"), matchId, playerOne, playerTwo, rulesHash, uint64(block.timestamp + 1 hours));
        bytes32 salt = keccak256("salt");
        vm.prank(playerOne); registry.commit(matchId, keccak256(abi.encode(uint8(1), salt)));
        vm.prank(playerTwo); registry.commit(matchId, keccak256(abi.encode(uint8(3), keccak256("invalid-two"))));
        vm.prank(playerOne); vm.expectRevert(TournamentResultRegistry.CommitmentMismatch.selector); registry.reveal(matchId, 1, bytes32(uint256(1)));
        vm.expectRevert(TournamentResultRegistry.InvalidState.selector); registry.finalize(matchId);
    }

    function testRevealRequiresBothCommitments() public {
        bytes32 matchId = keccak256("ordered-reveal");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        registry.createMatch(keccak256("ordered-reveal-tournament"), matchId, playerOne, playerTwo, rulesHash, deadline);
        bytes32 saltOne = keccak256("ordered-one");
        bytes32 saltTwo = keccak256("ordered-two");
        vm.prank(playerOne); registry.commit(matchId, keccak256(abi.encode(uint8(1), saltOne)));
        vm.prank(playerOne); vm.expectRevert(TournamentResultRegistry.InvalidState.selector); registry.reveal(matchId, 1, saltOne);
        vm.prank(playerTwo); registry.commit(matchId, keccak256(abi.encode(uint8(3), saltTwo)));
        vm.prank(playerTwo); registry.reveal(matchId, 3, saltTwo);
        vm.prank(playerOne); registry.reveal(matchId, 1, saltOne);
    }

    function testSecondPlayerCannotRevealBeforeFirstCommit() public {
        bytes32 matchId = keccak256("ordered-second");
        registry.createMatch(keccak256("ordered-second-tournament"), matchId, playerOne, playerTwo, rulesHash, uint64(block.timestamp + 1 hours));
        bytes32 saltTwo = keccak256("ordered-two-only");
        vm.prank(playerTwo); registry.commit(matchId, keccak256(abi.encode(uint8(3), saltTwo)));
        vm.prank(playerTwo); vm.expectRevert(TournamentResultRegistry.InvalidState.selector); registry.reveal(matchId, 3, saltTwo);
    }

    function testRevealChoiceRolesAndDuplicates() public {
        bytes32 matchId = keccak256("validation");
        registry.createMatch(keccak256("validation-tournament"), matchId, playerOne, playerTwo, rulesHash, uint64(block.timestamp + 1 hours));
        bytes32 saltOne = keccak256("validation-one");
        bytes32 saltTwo = keccak256("validation-two");
        vm.expectRevert(TournamentResultRegistry.NotPlayer.selector);
        registry.commit(matchId, keccak256(abi.encode(uint8(1), saltOne)));
        vm.prank(playerOne); registry.commit(matchId, keccak256(abi.encode(uint8(1), saltOne)));
        vm.prank(playerOne); vm.expectRevert(TournamentResultRegistry.AlreadyExists.selector); registry.commit(matchId, keccak256(abi.encode(uint8(1), saltOne)));
        vm.prank(playerTwo); registry.commit(matchId, keccak256(abi.encode(uint8(3), saltTwo)));
        vm.prank(playerOne); vm.expectRevert(TournamentResultRegistry.InvalidChoice.selector); registry.reveal(matchId, 0, saltOne);
        vm.prank(playerOne); registry.reveal(matchId, 1, saltOne);
        vm.prank(playerOne); vm.expectRevert(TournamentResultRegistry.InvalidState.selector); registry.reveal(matchId, 1, saltOne);
        vm.prank(playerTwo); registry.reveal(matchId, 3, saltTwo);
        vm.prank(playerTwo); vm.expectRevert(TournamentResultRegistry.InvalidState.selector); registry.reveal(matchId, 3, saltTwo);
        vm.expectRevert(TournamentResultRegistry.NotPlayer.selector);
        registry.reveal(matchId, 1, saltOne);
    }

    function testNonFinalizerCanFinalizeAfterBothReveals() public {
        bytes32 matchId = keccak256("permissionless-finalize");
        registry.createMatch(keccak256("permissionless-finalize-tournament"), matchId, playerOne, playerTwo, rulesHash, uint64(block.timestamp + 1 hours));
        _play(matchId, 1, 3);
        vm.prank(address(0xD44));
        registry.finalize(matchId);
        (,,,,,,,,,,,,,address winner,TournamentResultRegistry.Result result,,,) = registry.matches(matchId);
        assertEq(winner, playerOne);
        assertEq(uint8(result), uint8(TournamentResultRegistry.Result.PlayerOneWin));
    }

    function _play(bytes32 matchId, uint8 one, uint8 two) internal {
        bytes32 saltOne = keccak256("one");
        bytes32 saltTwo = keccak256("two");
        vm.prank(playerOne); registry.commit(matchId, keccak256(abi.encode(one, saltOne)));
        vm.prank(playerTwo); registry.commit(matchId, keccak256(abi.encode(two, saltTwo)));
        vm.prank(playerOne); registry.reveal(matchId, one, saltOne);
        vm.prank(playerTwo); registry.reveal(matchId, two, saltTwo);
    }
}
