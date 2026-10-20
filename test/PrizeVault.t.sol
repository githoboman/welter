// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PrizeVault} from "../contracts/creditcoin/PrizeVault.sol";
import {MockPrizeToken} from "../contracts/test/MockPrizeToken.sol";

contract PrizeVaultTest is Test {
    PrizeVault vault;
    MockPrizeToken token;
    address authority = address(0xA11);
    address organizer = address(0xB22);
    address winner = address(0xC33);
    bytes32 tournamentId = keccak256("vault-tournament");
    uint256 amount = 10 ether;

    function setUp() public {
        vault = new PrizeVault(authority);
        token = new MockPrizeToken();
        token.mint(organizer, amount);
    }

    function testPermissionlessClaimAlwaysPaysVerifiedWinner() public {
        _createAndFund(tournamentId);
        vm.prank(authority); vault.settle(tournamentId, winner, 1, bytes32(uint256(7)));
        vm.prank(address(0xD44)); vault.claimFor(tournamentId);
        assertEq(token.balanceOf(winner), amount);
        assertEq(token.balanceOf(address(0xD44)), 0);
        vm.expectRevert(PrizeVault.InvalidState.selector); vault.claimFor(tournamentId);
    }

    function testUnauthorizedSettlementAndRefundRevert() public {
        _createAndFund(tournamentId);
        vm.expectRevert(PrizeVault.Unauthorized.selector); vault.settle(tournamentId, winner, 1, bytes32(uint256(7)));
        vm.warp(block.timestamp + 101);
        vm.prank(winner); vm.expectRevert(PrizeVault.InvalidState.selector); vault.refund(tournamentId);
    }

    function testCreateRejectsZeroOrInvalidRefundDeadline() public {
        vm.startPrank(organizer);
        vm.expectRevert(PrizeVault.InvalidPolicy.selector);
        vault.createTournament(keccak256("zero-refund"), organizer, 1, address(0x123), bytes32(uint256(1)), address(token), amount, uint64(block.timestamp + 100), 0);
        vm.expectRevert(PrizeVault.InvalidPolicy.selector);
        vault.createTournament(keccak256("equal-deadlines"), organizer, 1, address(0x123), bytes32(uint256(1)), address(token), amount, uint64(block.timestamp + 100), uint64(block.timestamp + 100));
        vm.expectRevert(PrizeVault.InvalidPolicy.selector);
        vault.createTournament(keccak256("earlier-refund"), organizer, 1, address(0x123), bytes32(uint256(1)), address(token), amount, uint64(block.timestamp + 100), uint64(block.timestamp + 99));
        vm.stopPrank();
    }

    function testEarlyRefundAndSettlementBoundaryRevert() public {
        _createAndFund(tournamentId);
        vm.prank(organizer);
        vm.expectRevert(PrizeVault.InvalidState.selector);
        vault.refund(tournamentId);
        vm.warp(block.timestamp + 100);
        vm.prank(organizer);
        vm.expectRevert(PrizeVault.InvalidState.selector);
        vault.refund(tournamentId);
    }

    function testRefundAfterDeadlineConservesFunds() public {
        _createAndFund(tournamentId);
        assertEq(token.balanceOf(address(vault)), amount);
        vm.warp(block.timestamp + 101);
        vm.prank(organizer); vault.refund(tournamentId);
        assertEq(token.balanceOf(organizer), amount);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function testSettlementAndRefundBoundaryTimestamps() public {
        uint256 start = block.timestamp;
        _createAndFund(tournamentId);
        bytes32 refundId = keccak256("refund-boundary");
        token.mint(organizer, amount);
        _createAndFund(refundId);
        bytes32 recoveryId = keccak256("recovery-boundary");
        token.mint(organizer, amount);
        _createAndFund(recoveryId);

        vm.warp(start + 100);
        vm.prank(authority); vault.settle(tournamentId, winner, 1, bytes32(uint256(7)));
        vm.warp(start + 200);
        vm.prank(organizer); vault.refund(refundId);
        vm.expectRevert(PrizeVault.InvalidState.selector);
        vault.recoverExpired(recoveryId);
        vm.warp(start + 201);
        vault.recoverExpired(recoveryId);
    }

    function testExpiredRecoveryIsPermissionlessButPaysOnlyOrganizer() public {
        _createAndFund(tournamentId);
        uint256 before = token.balanceOf(organizer);
        vm.warp(block.timestamp + 301);
        address trigger = address(0xD44);
        vm.prank(trigger); vault.recoverExpired(tournamentId);
        assertEq(token.balanceOf(organizer), before + amount);
        assertEq(token.balanceOf(trigger), 0);
        assertEq(token.balanceOf(address(vault)), 0);
        (,,,,,,,,,,,PrizeVault.State state) = vault.policies(tournamentId);
        assertEq(uint8(state), uint8(PrizeVault.State.REFUNDED));
    }

    function testRecoveryBeforeWindowExpiresReverts() public {
        _createAndFund(tournamentId);
        vm.warp(block.timestamp + 200);
        vm.expectRevert(PrizeVault.InvalidState.selector);
        vault.recoverExpired(tournamentId);
    }

    function testRecoveryCannotFollowSettlementOrClaim() public {
        _createAndFund(tournamentId);
        vm.prank(authority); vault.settle(tournamentId, winner, 1, bytes32(uint256(7)));
        vm.warp(block.timestamp + 301);
        vm.expectRevert(PrizeVault.InvalidState.selector);
        vault.recoverExpired(tournamentId);

        vm.prank(address(0xD44)); vault.claimFor(tournamentId);
        vm.expectRevert(PrizeVault.InvalidState.selector);
        vault.recoverExpired(tournamentId);
    }

    function testRecoveryCannotFollowNormalRefundOrRunTwice() public {
        _createAndFund(tournamentId);
        vm.warp(block.timestamp + 101);
        vm.prank(organizer); vault.refund(tournamentId);
        vm.prank(organizer); vm.expectRevert(PrizeVault.InvalidState.selector); vault.refund(tournamentId);
        vm.prank(authority); vm.expectRevert(PrizeVault.InvalidState.selector); vault.settle(tournamentId, winner, 1, bytes32(uint256(7)));
        vm.expectRevert(PrizeVault.InvalidState.selector);
        vault.recoverExpired(tournamentId);

        bytes32 secondId = keccak256("second-recovery");
        _createAndFund(secondId);
        vm.warp(block.timestamp + 201);
        vault.recoverExpired(secondId);
        vm.expectRevert(PrizeVault.InvalidState.selector);
        vault.recoverExpired(secondId);
        vm.expectRevert(PrizeVault.InvalidState.selector);
        vm.prank(organizer); vault.refund(secondId);
    }

    function testSettlementAfterRecoveryRevertsAndFundsConserve() public {
        _createAndFund(tournamentId);
        vm.warp(block.timestamp + 301);
        vault.recoverExpired(tournamentId);
        vm.expectRevert(PrizeVault.InvalidState.selector);
        vm.prank(authority); vault.settle(tournamentId, winner, 1, bytes32(uint256(7)));
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(token.balanceOf(organizer), amount);
    }

    function testRefundAfterPayoutReverts() public {
        _createAndFund(tournamentId);
        vm.prank(authority); vault.settle(tournamentId, winner, 1, bytes32(uint256(7)));
        vault.claimFor(tournamentId);
        vm.warp(block.timestamp + 301);
        vm.prank(organizer); vm.expectRevert(PrizeVault.InvalidState.selector); vault.refund(tournamentId);
    }

    function testFuzzClaimConservesFunds(uint96 rawAmount) public {
        uint256 fuzzAmount = bound(uint256(rawAmount), 1, type(uint96).max);
        bytes32 id = keccak256(abi.encode(fuzzAmount));
        token.mint(organizer, fuzzAmount);
        vm.prank(organizer); vault.createTournament(id, organizer, 1, address(0x123), bytes32(uint256(1)), address(token), fuzzAmount, uint64(block.timestamp + 100), uint64(block.timestamp + 200));
        vm.prank(organizer); token.approve(address(vault), fuzzAmount);
        vm.prank(organizer); vault.fund(id);
        vm.prank(authority); vault.settle(id, winner, 1, bytes32(uint256(9)));
        vault.claimFor(id);
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(token.balanceOf(winner), fuzzAmount);
    }

    function testFuzzRefundOrRecoveryConservesFunds(uint96 rawAmount, bool expiredRecovery) public {
        uint256 fuzzAmount = bound(uint256(rawAmount), 1, type(uint96).max);
        uint256 start = block.timestamp;
        bytes32 id = keccak256(abi.encode(fuzzAmount, expiredRecovery));
        token.mint(organizer, fuzzAmount);
        vm.prank(organizer); vault.createTournament(id, organizer, 1, address(0x123), bytes32(uint256(1)), address(token), fuzzAmount, uint64(start + 100), uint64(start + 200));
        vm.prank(organizer); token.approve(address(vault), fuzzAmount);
        vm.prank(organizer); vault.fund(id);
        uint256 before = token.balanceOf(organizer);
        if (expiredRecovery) {
            vm.warp(start + 201);
            vm.prank(address(0xD44)); vault.recoverExpired(id);
        } else {
            vm.warp(start + 101);
            vm.prank(organizer); vault.refund(id);
        }
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(token.balanceOf(organizer), before + fuzzAmount);
    }

    function _createAndFund(bytes32 id) internal {
        vm.prank(organizer); vault.createTournament(id, organizer, 1, address(0x123), bytes32(uint256(1)), address(token), amount, uint64(block.timestamp + 100), uint64(block.timestamp + 200));
        vm.prank(organizer); token.approve(address(vault), amount);
        vm.prank(organizer); vault.fund(id);
    }
}
