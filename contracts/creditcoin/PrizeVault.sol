// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PrizeVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum State { DRAFT, FUNDED, CLAIMABLE, CLAIMED, REFUNDED }
    struct Policy {
        address organizer;
        uint64 sourceChainKey;
        address sourceRegistry;
        bytes32 rulesHash;
        address token;
        uint256 amount;
        uint64 settlementDeadline;
        uint64 refundDeadline;
        address winner;
        uint256 resultNonce;
        bytes32 sourceQueryKey;
        State state;
    }

    address public immutable settlementAuthority;
    mapping(bytes32 => Policy) public policies;

    event TournamentCreated(bytes32 indexed tournamentId, address indexed organizer, address sourceRegistry, bytes32 rulesHash, uint256 amount);
    event TournamentFunded(bytes32 indexed tournamentId, uint256 amount);
    event TournamentSettled(bytes32 indexed tournamentId, address indexed winner, uint256 resultNonce, bytes32 sourceQueryKey);
    event PrizeClaimed(bytes32 indexed tournamentId, address indexed winner, uint256 amount);
    event TournamentRefunded(bytes32 indexed tournamentId, address indexed organizer, uint256 amount);
    event TournamentRecovered(bytes32 indexed tournamentId, address indexed organizer, uint256 amount);

    error Unauthorized(); error InvalidState(); error InvalidPolicy(); error TransferFailed();

    constructor(address settlementAuthority_) {
        if (settlementAuthority_ == address(0)) revert InvalidPolicy();
        settlementAuthority = settlementAuthority_;
    }

    function createTournament(
        bytes32 tournamentId,
        address organizer,
        uint64 sourceChainKey,
        address sourceRegistry,
        bytes32 rulesHash,
        address token,
        uint256 amount,
        uint64 settlementDeadline,
        uint64 refundDeadline
    ) external {
        if (msg.sender != organizer) revert Unauthorized();
        if (tournamentId == bytes32(0) || organizer == address(0) || sourceRegistry == address(0) || token == address(0) || amount == 0 || settlementDeadline <= block.timestamp || refundDeadline <= settlementDeadline) revert InvalidPolicy();
        if (policies[tournamentId].organizer != address(0)) revert InvalidPolicy();
        policies[tournamentId] = Policy(organizer, sourceChainKey, sourceRegistry, rulesHash, token, amount, settlementDeadline, refundDeadline, address(0), 0, bytes32(0), State.DRAFT);
        emit TournamentCreated(tournamentId, organizer, sourceRegistry, rulesHash, amount);
    }

    function fund(bytes32 tournamentId) external nonReentrant {
        Policy storage p = policies[tournamentId];
        if (p.organizer == address(0) || p.state != State.DRAFT || msg.sender != p.organizer) revert InvalidState();
        IERC20(p.token).safeTransferFrom(msg.sender, address(this), p.amount);
        p.state = State.FUNDED;
        emit TournamentFunded(tournamentId, p.amount);
    }

    function settle(bytes32 tournamentId, address winner, uint256 resultNonce, bytes32 sourceQueryKey) external {
        if (msg.sender != settlementAuthority) revert Unauthorized();
        Policy storage p = policies[tournamentId];
        if (p.state != State.FUNDED || block.timestamp > p.settlementDeadline || winner == address(0) || resultNonce == 0 || sourceQueryKey == bytes32(0)) revert InvalidState();
        p.winner = winner;
        p.resultNonce = resultNonce;
        p.sourceQueryKey = sourceQueryKey;
        p.state = State.CLAIMABLE;
        emit TournamentSettled(tournamentId, winner, resultNonce, sourceQueryKey);
    }

    function claimFor(bytes32 tournamentId) external nonReentrant {
        Policy storage p = policies[tournamentId];
        if (p.state != State.CLAIMABLE) revert InvalidState();
        p.state = State.CLAIMED;
        IERC20(p.token).safeTransfer(p.winner, p.amount);
        emit PrizeClaimed(tournamentId, p.winner, p.amount);
    }

    function refund(bytes32 tournamentId) external nonReentrant {
        Policy storage p = policies[tournamentId];
        if (msg.sender != p.organizer || p.state != State.FUNDED || block.timestamp <= p.settlementDeadline || block.timestamp > p.refundDeadline) revert InvalidState();
        p.state = State.REFUNDED;
        IERC20(p.token).safeTransfer(p.organizer, p.amount);
        emit TournamentRefunded(tournamentId, p.organizer, p.amount);
    }

    /// @notice Permissionless recovery after the organizer refund window expires.
    /// The beneficiary is always the immutable organizer stored in the policy.
    function recoverExpired(bytes32 tournamentId) external nonReentrant {
        Policy storage p = policies[tournamentId];
        if (p.organizer == address(0) || p.state != State.FUNDED || block.timestamp <= p.refundDeadline) revert InvalidState();
        p.state = State.REFUNDED;
        IERC20(p.token).safeTransfer(p.organizer, p.amount);
        emit TournamentRecovered(tournamentId, p.organizer, p.amount);
    }
}
