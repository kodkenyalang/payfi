// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/ISomnia.sol";

contract MockOracle {
    bytes32 public lastRequestId;
    uint256 public lastJobId;
    string public lastUrl;
    string public lastRequirements;

    event MockParseRequested(bytes32 indexed requestId, uint256 indexed jobId, string url);

    function requestEvaluation(
        uint256 jobId,
        string calldata url,
        string calldata requirements
    ) external returns (bytes32 requestId) {
        requestId = keccak256(abi.encodePacked(jobId, url, block.timestamp));
        lastRequestId = requestId;
        lastJobId = jobId;
        lastUrl = url;
        lastRequirements = requirements;
        emit MockParseRequested(requestId, jobId, url);
        return requestId;
    }
}
