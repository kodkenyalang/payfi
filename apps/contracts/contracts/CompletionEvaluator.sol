// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ISomnia.sol";

interface IFlowFiEscrow {
    function fulfillEvaluation(bytes32 requestId, uint256 score, string calldata reason) external;
}

contract CompletionEvaluator is Ownable {

    ISomniaLLMInference public somniaInferenceAgent;
    address public oracle;
    address public escrow;
    address public somniaAgent;

    mapping(bytes32 => bytes32) public evalToParseRequestId;

    event ScoreRequested(bytes32 indexed evalRequestId, bytes32 indexed parseRequestId, uint256 jobId);
    event ScoreFulfilled(bytes32 indexed evalRequestId, uint256 score, string reason);
    event ParseError(bytes32 indexed evalRequestId, string rawResponse);

    error OnlyOracle();
    error OnlySomniaAgent();
    error ZeroAddress();

    constructor(
        address _somniaInferenceAgent,
        address _somniaAgent
    ) Ownable(msg.sender) {
        if (_somniaInferenceAgent == address(0)) revert ZeroAddress();
        if (_somniaAgent == address(0)) revert ZeroAddress();
        somniaInferenceAgent = ISomniaLLMInference(_somniaInferenceAgent);
        somniaAgent = _somniaAgent;
    }

    function setOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert ZeroAddress();
        oracle = _oracle;
    }

    function setEscrow(address _escrow) external onlyOwner {
        if (_escrow == address(0)) revert ZeroAddress();
        escrow = _escrow;
    }

    modifier onlyOracle() {
        if (msg.sender != oracle) revert OnlyOracle();
        _;
    }

    modifier onlySomniaAgent() {
        if (msg.sender != somniaAgent) revert OnlySomniaAgent();
        _;
    }

    function requestScore(
        bytes32 parseRequestId,
        string calldata deliverableContent,
        string calldata requirements,
        uint256 jobId
    ) external onlyOracle returns (bytes32 evalRequestId) {
        string memory prompt = _buildPrompt(requirements, deliverableContent);
        evalRequestId = somniaInferenceAgent.request(prompt);
        evalToParseRequestId[evalRequestId] = parseRequestId;
        emit ScoreRequested(evalRequestId, parseRequestId, jobId);
    }

    function fulfillScore(
        bytes32 evalRequestId,
        string calldata jsonResponse
    ) external onlySomniaAgent {
        (uint256 score, string memory reason) = _parseScore(jsonResponse);

        if (bytes(reason).length == 0) {
            reason = "parse_error";
            score = 0;
            emit ParseError(evalRequestId, jsonResponse);
        }

        emit ScoreFulfilled(evalRequestId, score, reason);

        IFlowFiEscrow(escrow).fulfillEvaluation(
            evalToParseRequestId[evalRequestId],
            score,
            reason
        );
    }

    function _buildPrompt(
        string memory requirements,
        string memory deliverableContent
    ) internal pure returns (string memory) {
        return string.concat(
            "You are a payment arbitration system. Given project requirements and a deliverable summary, score completion from 0-100.\n",
            "Requirements: ", requirements, "\n",
            "Deliverable: ", deliverableContent, "\n",
            'Respond with ONLY a valid JSON object on a single line, no other text: {"score": <integer 0-100>, "reason": "<one sentence under 100 chars>"}'
        );
    }

    function _parseScore(
        string calldata json
    ) internal pure returns (uint256 score, string memory reason) {
        bytes memory b = bytes(json);

        bytes memory scoreKey = bytes('"score":');
        uint256 scoreStart = _findSubstring(b, scoreKey);
        if (scoreStart == type(uint256).max) return (0, "parse_error");

        uint256 numStart = scoreStart + scoreKey.length;
        while (numStart < b.length && (b[numStart] == ' ' || b[numStart] == '\t')) {
            numStart++;
        }
        if (numStart >= b.length) return (0, "parse_error");

        uint256 numEnd = numStart;
        uint256 parsed = 0;
        bool foundDigit = false;
        while (numEnd < b.length && b[numEnd] >= '0' && b[numEnd] <= '9') {
            parsed = parsed * 10 + (uint8(b[numEnd]) - 48);
            numEnd++;
            foundDigit = true;
        }
        if (!foundDigit) return (0, "parse_error");
        score = parsed > 100 ? 100 : parsed;

        bytes memory reasonKey = bytes('"reason":"');
        uint256 reasonStart = _findSubstring(b, reasonKey);
        if (reasonStart == type(uint256).max) return (score, "parse_error");

        uint256 rStart = reasonStart + reasonKey.length;
        uint256 rEnd = rStart;
        while (rEnd < b.length && b[rEnd] != '"') {
            if (b[rEnd] == '\\' && rEnd + 1 < b.length && b[rEnd + 1] == '"') {
                rEnd += 2;
                continue;
            }
            rEnd++;
        }
        if (rEnd >= b.length) return (score, "parse_error");

        bytes memory reasonBytes = new bytes(rEnd - rStart);
        for (uint256 i = 0; i < rEnd - rStart; i++) {
            reasonBytes[i] = b[rStart + i];
        }
        reason = string(reasonBytes);
    }

    function _findSubstring(
        bytes memory haystack,
        bytes memory needle
    ) internal pure returns (uint256) {
        if (needle.length > haystack.length) return type(uint256).max;
        for (uint256 i = 0; i <= haystack.length - needle.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return i;
        }
        return type(uint256).max;
    }
}
