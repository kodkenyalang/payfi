// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockLLMInference {
    uint256 private _counter;

    function request(string calldata /*prompt*/) external returns (bytes32 requestId) {
        _counter++;
        requestId = keccak256(abi.encodePacked("mock-inference-", _counter));
        return requestId;
    }
}
