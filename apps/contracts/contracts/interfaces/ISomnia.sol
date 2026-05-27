// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISomniaLLMParseWebsite {
    function request(
        string calldata url,
        string calldata extractionPrompt
    ) external returns (bytes32 requestId);
}

interface ISomniaLLMInference {
    function request(
        string calldata prompt
    ) external returns (bytes32 requestId);
}
