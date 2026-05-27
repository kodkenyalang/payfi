// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFlowFiEscrow {
    function fulfillEvaluation(bytes32 requestId, uint256 score, string calldata reason) external;
}

contract MockEvaluator {
    bytes32 public lastRequestId;

    function requestScore(
        bytes32 parseRequestId,
        string calldata /*deliverableContent*/,
        string calldata /*requirements*/,
        uint256 /*jobId*/
    ) external returns (bytes32 evalRequestId) {
        evalRequestId = keccak256(abi.encodePacked(parseRequestId, "eval"));
        lastRequestId = evalRequestId;
        return evalRequestId;
    }

    function mockFulfill(
        address escrow,
        bytes32 requestId,
        uint256 score,
        string calldata reason
    ) external {
        IFlowFiEscrow(escrow).fulfillEvaluation(requestId, score, reason);
    }
}
