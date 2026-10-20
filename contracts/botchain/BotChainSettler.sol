// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ITournamentResultRegistry {
    function matches(bytes32 matchId) external view returns (
        bytes32 tournamentId,
        bytes32 matchId_,
        address playerOne,
        address playerTwo,
        bytes32 rulesHash,
        uint64 revealDeadline,
        bytes32 playerOneCommit,
        bytes32 playerTwoCommit,
        uint8 playerOneChoice,
        uint8 playerTwoChoice,
        bool playerOneRevealed,
        bool playerTwoRevealed,
        bool finalized,
        address winner,
        uint8 result,
        uint8 status,
        uint256 resultNonce,
        uint64 finalizedAt
    );
}

interface IPrizeVault {
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
        uint8 state;
    }
    function policies(bytes32 tournamentId) external view returns (Policy memory);
    function settle(bytes32 tournamentId, address winner, uint256 resultNonce, bytes32 sourceQueryKey) external;
}

/// @notice Direct settlement contract for BOT Chain native tournament prize escrow.
/// Verifies finalized matches on TournamentResultRegistry and unlocks the prize in PrizeVault.
contract BotChainSettler {
    IPrizeVault public immutable vault;
    ITournamentResultRegistry public immutable registry;

    mapping(bytes32 => bool) public settledTournaments;

    event MatchSettledOnBotChain(
        bytes32 indexed tournamentId,
        bytes32 indexed matchId,
        address indexed winner,
        uint256 resultNonce
    );

    error AlreadySettled();
    error MatchNotFinalized();
    error NoWinner();
    error TournamentMismatch();
    error RulesMismatch();
    error WrongRegistry();

    constructor(address vault_, address registry_) {
        vault = IPrizeVault(vault_);
        registry = ITournamentResultRegistry(registry_);
    }

    /// @notice Permissionlessly triggers prize vault settlement once match is finalized on-chain
    function settleMatch(bytes32 tournamentId, bytes32 matchId) external {
        if (settledTournaments[tournamentId]) revert AlreadySettled();

        IPrizeVault.Policy memory policy = vault.policies(tournamentId);
        if (policy.sourceRegistry != address(registry)) revert WrongRegistry();

        (
            bytes32 mTournamentId,
            ,
            ,
            ,
            bytes32 mRulesHash,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            bool finalized,
            address winner,
            ,
            ,
            uint256 resultNonce,
            
        ) = registry.matches(matchId);

        if (!finalized) revert MatchNotFinalized();
        if (mTournamentId != tournamentId) revert TournamentMismatch();
        if (mRulesHash != policy.rulesHash) revert RulesMismatch();
        if (winner == address(0)) revert NoWinner();

        settledTournaments[tournamentId] = true;
        vault.settle(tournamentId, winner, resultNonce, matchId);

        emit MatchSettledOnBotChain(tournamentId, matchId, winner, resultNonce);
    }
}
