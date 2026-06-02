// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/ISomnia.sol";

interface IHandleResponse {
    function handleResponse(uint256, Response[] memory, ResponseStatus, AgentRequest memory) external;
}

contract MockAgentRequester {
    uint256 private _nextRequestId;

    uint256 public constant RESERVE_DEPOSIT = 0.001 ether;
    uint256 public constant REWARD_PER_AGENT = 0.03 ether;

    uint256 public lastAgentId;
    address public lastCallbackAddress;
    bytes4  public lastCallbackSelector;
    bytes   public lastPayload;

    ResponseStatus public _mockStatus = ResponseStatus.Success;
    bytes          public _mockResult;

    function setMockResult(ResponseStatus status, bytes calldata result) external {
        _mockStatus = status;
        _mockResult = result;
    }

    function getRequestDeposit() external view returns (uint256) {
        return RESERVE_DEPOSIT;
    }

    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4  callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId) {
        require(msg.value >= RESERVE_DEPOSIT + REWARD_PER_AGENT * 3, "insufficient deposit");

        lastAgentId = agentId;
        lastCallbackAddress = callbackAddress;
        lastCallbackSelector = callbackSelector;
        lastPayload = payload;

        requestId = _nextRequestId++;

        address[] memory subcommittee = new address[](3);
        subcommittee[0] = address(0x1);
        subcommittee[1] = address(0x2);
        subcommittee[2] = address(0x3);

        Response[] memory responses = new Response[](1);
        responses[0] = Response({
            validator: address(0x1),
            result: _mockResult,
            status: _mockStatus,
            receipt: 1,
            timestamp: block.timestamp,
            executionCost: REWARD_PER_AGENT
        });

        AgentRequest memory details = AgentRequest({
            id: requestId,
            requester: address(this),
            callbackAddress: callbackAddress,
            callbackSelector: callbackSelector,
            subcommittee: subcommittee,
            responses: responses,
            responseCount: 1,
            failureCount: 0,
            threshold: 2,
            createdAt: block.timestamp,
            deadline: block.timestamp + 1 hours,
            status: _mockStatus,
            consensusType: ConsensusType.Majority,
            remainingBudget: msg.value - RESERVE_DEPOSIT,
            perAgentBudget: REWARD_PER_AGENT
        });

        IHandleResponse(callbackAddress).handleResponse(
            requestId, responses, _mockStatus, details
        );
    }
}
