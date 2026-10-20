// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @dev Local-only verifier double. It is never used by the load-bearing SDK path.
contract MockNativeQueryVerifier {
    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata proof) external pure returns (uint64) { return uint64(uint256(proof.root)); }
    function verifyAndEmit(uint64, uint64, bytes calldata, INativeQueryVerifier.MerkleProof calldata, INativeQueryVerifier.ContinuityProof calldata) external pure returns (bool) { return true; }
    function verifyAndEmit(uint64, uint64[] calldata, bytes[] calldata, INativeQueryVerifier.MerkleProof[] calldata, INativeQueryVerifier.ContinuityProof calldata) external pure returns (bool) { return true; }
    function verify(uint64, uint64, bytes calldata, INativeQueryVerifier.MerkleProof calldata, INativeQueryVerifier.ContinuityProof calldata) external pure returns (bool) { return true; }
    function verify(uint64, uint64[] calldata, bytes[] calldata, INativeQueryVerifier.MerkleProof[] calldata, INativeQueryVerifier.ContinuityProof calldata) external pure returns (bool) { return true; }
}

contract RejectingNativeQueryVerifier {
    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata) external pure returns (uint64) { return 0; }
    function verifyAndEmit(uint64, uint64, bytes calldata, INativeQueryVerifier.MerkleProof calldata, INativeQueryVerifier.ContinuityProof calldata) external pure returns (bool) { return false; }
}
