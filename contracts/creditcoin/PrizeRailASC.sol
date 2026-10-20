// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ASCBase} from "@gluwa/asc-contracts/contracts/readability/ASCBase.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

interface IPrizeVault {
    struct Policy { address organizer; uint64 sourceChainKey; address sourceRegistry; bytes32 rulesHash; address token; uint256 amount; uint64 settlementDeadline; uint64 refundDeadline; address winner; uint256 resultNonce; bytes32 sourceQueryKey; uint8 state; }
    function policies(bytes32 tournamentId) external view returns (Policy memory);
    function settle(bytes32 tournamentId, address winner, uint256 resultNonce, bytes32 sourceQueryKey) external;
}

contract PrizeRailASC is ASCBase {
    uint8 public constant ACTION_MATCH_FINALIZED = 0;
    uint64 public constant EXPECTED_SOURCE_CHAIN_ID = 11155111;
    bytes32 public constant MATCH_FINALIZED_SIGNATURE = keccak256("MatchFinalized(bytes32,bytes32,address,address,address,uint8,bytes32,uint256,uint8,uint64,uint64,uint64)");
    IPrizeVault public immutable vault;
    uint64 public immutable expectedSourceChainKey;
    mapping(bytes32 => bool) public usedBusinessResults;
    mapping(bytes32 => bool) public usedSourceQueries;

    event ResultVerified(bytes32 indexed tournamentId, bytes32 indexed businessKey, bytes32 indexed sourceQueryKey, address winner, uint256 resultNonce);

    error InvalidAction(); error FailedReceipt(); error MissingEvent(); error WrongSource(); error WrongChain(); error WrongRules(); error WrongWinner(); error InvalidFinalization(); error ReplaySource(); error ReplayBusiness(); error Expired();

    constructor(address vault_, uint64 expectedSourceChainKey_) {
        vault = IPrizeVault(vault_);
        expectedSourceChainKey = expectedSourceChainKey_;
    }

    function _processAndEmitEvent(uint8 action, bytes32 queryId, bytes memory encodedTransaction) internal override {
        if (action != ACTION_MATCH_FINALIZED) revert InvalidAction();
        bytes32 sourceQueryKey = keccak256(encodedTransaction);
        if (usedSourceQueries[sourceQueryKey]) revert ReplaySource();
        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) revert FailedReceipt();
        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(receipt, MATCH_FINALIZED_SIGNATURE);
        if (logs.length == 0) revert MissingEvent();
        EvmV1Decoder.LogEntry memory log = logs[0];
        if (log.topics.length != 2 || log.topics[1] == bytes32(0)) revert MissingEvent();
        bytes32 tournamentId = log.topics[1];
        IPrizeVault.Policy memory p = vault.policies(tournamentId);
        if (p.organizer == address(0)) revert WrongSource();
        if (p.sourceChainKey != expectedSourceChainKey) revert WrongChain();
        if (log.address_ != p.sourceRegistry) revert WrongSource();
        (bytes32 matchId, address playerOne, address playerTwo, address winner, uint8 result, bytes32 rulesHash, uint256 resultNonce, uint8 status, uint64 sourceChainId, uint64 finalizedAt, uint64 deadline) = abi.decode(log.data, (bytes32,address,address,address,uint8,bytes32,uint256,uint8,uint64,uint64,uint64));
        playerOne; playerTwo; matchId;
        if (sourceChainId != EXPECTED_SOURCE_CHAIN_ID) revert WrongChain();
        if (rulesHash != p.rulesHash) revert WrongRules();
        if (resultNonce != uint256(keccak256(abi.encode(matchId)))) revert InvalidFinalization();
        if (status == 0) {
            if (result != 1 && result != 2) revert InvalidFinalization();
            if ((result == 1 && winner != playerOne) || (result == 2 && winner != playerTwo)) revert WrongWinner();
        } else if (status == 1) {
            if (finalizedAt <= deadline || (result != 3 && result != 4)) revert InvalidFinalization();
            if ((result == 3 && winner != playerOne) || (result == 4 && winner != playerTwo)) revert WrongWinner();
        } else {
            revert InvalidFinalization();
        }
        if (block.timestamp > p.settlementDeadline) revert Expired();
        bytes32 businessKey = keccak256(abi.encode(p.sourceChainKey, p.sourceRegistry, tournamentId, resultNonce));
        if (usedBusinessResults[businessKey]) revert ReplayBusiness();
        usedSourceQueries[sourceQueryKey] = true;
        usedBusinessResults[businessKey] = true;
        vault.settle(tournamentId, winner, resultNonce, sourceQueryKey);
        emit ResultVerified(tournamentId, businessKey, sourceQueryKey, winner, resultNonce);
    }

    function verifyAndSettle(
        uint8 action,
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external returns (bool success) {
        if (chainKey != expectedSourceChainKey) revert WrongChain();
        bytes32 queryId = _computeQueryId(chainKey, blockHeight, merkleRoot, siblings);
        if (processedQueries[queryId]) revert ReplaySource();
        if (!_verifyProof(chainKey, blockHeight, encodedTransaction, merkleRoot, siblings, lowerEndpointDigest, continuityRoots)) {
            revert FailedReceipt();
        }
        processedQueries[queryId] = true;
        _processAndEmitEvent(action, queryId, encodedTransaction);
        return true;
    }
}
