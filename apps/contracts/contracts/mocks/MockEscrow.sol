// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockEscrow {
    uint256 public lastScore;
    string public lastReason;
    bytes32 public lastRequestId;

    event FulfillmentCalled(bytes32 indexed requestId, uint256 score, string reason);

    function fulfillEvaluation(
        bytes32 requestId,
        uint256 score,
        string calldata reason
    ) external {
        lastRequestId = requestId;
        lastScore = score;
        lastReason = reason;
        emit FulfillmentCalled(requestId, score, reason);
    }

    function lastFulfillment() external view returns (uint256 score, bytes32 requestId, string memory reason) {
        return (lastScore, lastRequestId, lastReason);
    }
}
