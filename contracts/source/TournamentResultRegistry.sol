// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Deterministic commit/reveal RPS result source for the PrizeRail proof.
/// @dev This is a reference game, not a general tournament engine. The finalizer can
///      advance timeouts, but cannot select a winner or alter revealed choices.
contract TournamentResultRegistry {
    enum Choice { None, Rock, Paper, Scissors }
    enum Result { Draw, PlayerOneWin, PlayerTwoWin, TimeoutPlayerOneWin, TimeoutPlayerTwoWin, InvalidReveal }
    enum FinalizationStatus { Normal, Timeout, Invalid }

    struct Match {
        bytes32 tournamentId;
        bytes32 matchId;
        address playerOne;
        address playerTwo;
        bytes32 rulesHash;
        uint64 revealDeadline;
        bytes32 playerOneCommit;
        bytes32 playerTwoCommit;
        Choice playerOneChoice;
        Choice playerTwoChoice;
        bool playerOneRevealed;
        bool playerTwoRevealed;
        bool finalized;
        address winner;
        Result result;
        FinalizationStatus status;
        uint256 resultNonce;
        uint64 finalizedAt;
    }

    address public immutable finalizer;
    uint256 public immutable sourceChainId;
    mapping(bytes32 => Match) public matches;

    event MatchCreated(bytes32 indexed tournamentId, bytes32 indexed matchId, address playerOne, address playerTwo, bytes32 rulesHash, uint64 revealDeadline);
    event MoveCommitted(bytes32 indexed matchId, address indexed player);
    event MoveRevealed(bytes32 indexed matchId, address indexed player, uint8 choice);
    event MatchFinalized(
        bytes32 indexed tournamentId,
        bytes32 matchId,
        address playerOne,
        address playerTwo,
        address winner,
        uint8 result,
        bytes32 rulesHash,
        uint256 resultNonce,
        uint8 finalizationStatus,
        uint64 sourceChainId,
        uint64 finalizedAt,
        uint64 deadline
    );

    error Unauthorized();
    error AlreadyExists();
    error InvalidMatch();
    error InvalidState();
    error InvalidChoice();
    error CommitmentMismatch();
    error NotPlayer();

    constructor(address finalizer_) {
        if (finalizer_ == address(0)) revert InvalidMatch();
        finalizer = finalizer_;
        sourceChainId = block.chainid;
    }

    function createMatch(
        bytes32 tournamentId,
        bytes32 matchId,
        address playerOne,
        address playerTwo,
        bytes32 rulesHash,
        uint64 revealDeadline
    ) external onlyFinalizer {
        if (matchId == bytes32(0) || tournamentId == bytes32(0) || playerOne == address(0) || playerTwo == address(0) || playerOne == playerTwo) revert InvalidMatch();
        if (matches[matchId].matchId != bytes32(0)) revert AlreadyExists();
        if (revealDeadline <= block.timestamp) revert InvalidMatch();
        matches[matchId] = Match({
            tournamentId: tournamentId,
            matchId: matchId,
            playerOne: playerOne,
            playerTwo: playerTwo,
            rulesHash: rulesHash,
            revealDeadline: revealDeadline,
            playerOneCommit: bytes32(0),
            playerTwoCommit: bytes32(0),
            playerOneChoice: Choice.None,
            playerTwoChoice: Choice.None,
            playerOneRevealed: false,
            playerTwoRevealed: false,
            finalized: false,
            winner: address(0),
            result: Result.Draw,
            status: FinalizationStatus.Normal,
            resultNonce: 0,
            finalizedAt: 0
        });
        emit MatchCreated(tournamentId, matchId, playerOne, playerTwo, rulesHash, revealDeadline);
    }

    function commit(bytes32 matchId, bytes32 commitment) external {
        Match storage m = matches[matchId];
        if (m.matchId == bytes32(0) || m.finalized || commitment == bytes32(0) || block.timestamp > m.revealDeadline) revert InvalidState();
        if (msg.sender == m.playerOne) {
            if (m.playerOneCommit != bytes32(0)) revert AlreadyExists();
            m.playerOneCommit = commitment;
        } else if (msg.sender == m.playerTwo) {
            if (m.playerTwoCommit != bytes32(0)) revert AlreadyExists();
            m.playerTwoCommit = commitment;
        } else revert NotPlayer();
        emit MoveCommitted(matchId, msg.sender);
    }

    function reveal(bytes32 matchId, uint8 choice, bytes32 salt) external {
        Match storage m = matches[matchId];
        if (m.matchId == bytes32(0) || m.finalized || block.timestamp > m.revealDeadline) revert InvalidState();
        if (m.playerOneCommit == bytes32(0) || m.playerTwoCommit == bytes32(0)) revert InvalidState();
        if (choice < uint8(Choice.Rock) || choice > uint8(Choice.Scissors)) revert InvalidChoice();
        bytes32 expected = keccak256(abi.encode(choice, salt));
        if (msg.sender == m.playerOne) {
            if (m.playerOneCommit == bytes32(0) || m.playerOneRevealed) revert InvalidState();
            if (expected != m.playerOneCommit) revert CommitmentMismatch();
            m.playerOneChoice = Choice(choice);
            m.playerOneRevealed = true;
        } else if (msg.sender == m.playerTwo) {
            if (m.playerTwoCommit == bytes32(0) || m.playerTwoRevealed) revert InvalidState();
            if (expected != m.playerTwoCommit) revert CommitmentMismatch();
            m.playerTwoChoice = Choice(choice);
            m.playerTwoRevealed = true;
        } else revert NotPlayer();
        emit MoveRevealed(matchId, msg.sender, choice);
    }

    function finalize(bytes32 matchId) external {
        Match storage m = matches[matchId];
        if (m.matchId == bytes32(0) || m.finalized) revert InvalidState();
        bool bothRevealed = m.playerOneRevealed && m.playerTwoRevealed;
        bool timedOut = block.timestamp > m.revealDeadline;
        if (!bothRevealed && !timedOut) revert InvalidState();

        m.finalized = true;
        m.finalizedAt = uint64(block.timestamp);
        m.resultNonce = uint256(keccak256(abi.encode(m.matchId)));
        if (bothRevealed) {
            if (m.playerOneChoice == m.playerTwoChoice) {
                m.result = Result.Draw;
            } else if (_beats(m.playerOneChoice, m.playerTwoChoice)) {
                m.result = Result.PlayerOneWin;
                m.winner = m.playerOne;
            } else {
                m.result = Result.PlayerTwoWin;
                m.winner = m.playerTwo;
            }
            m.status = FinalizationStatus.Normal;
        } else if (m.playerOneRevealed) {
            m.result = Result.TimeoutPlayerOneWin;
            m.winner = m.playerOne;
            m.status = FinalizationStatus.Timeout;
        } else if (m.playerTwoRevealed) {
            m.result = Result.TimeoutPlayerTwoWin;
            m.winner = m.playerTwo;
            m.status = FinalizationStatus.Timeout;
        } else {
            m.result = Result.Draw;
            m.status = FinalizationStatus.Timeout;
        }

        emit MatchFinalized(
            m.tournamentId,
            m.matchId,
            m.playerOne,
            m.playerTwo,
            m.winner,
            uint8(m.result),
            m.rulesHash,
            m.resultNonce,
            uint8(m.status),
            uint64(sourceChainId),
            m.finalizedAt,
            m.revealDeadline
        );
    }

    function _beats(Choice a, Choice b) internal pure returns (bool) {
        return (a == Choice.Rock && b == Choice.Scissors) || (a == Choice.Paper && b == Choice.Rock) || (a == Choice.Scissors && b == Choice.Paper);
    }

    modifier onlyFinalizer() {
        if (msg.sender != finalizer) revert Unauthorized();
        _;
    }
}
