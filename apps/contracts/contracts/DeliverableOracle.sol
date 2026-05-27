// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ISomnia.sol";

interface ICompletionEvaluator {
    function requestScore(
        bytes32 parseRequestId,
        string calldata deliverableContent,
        string calldata requirements,
        uint256 jobId
    ) external returns (bytes32);
}

interface IFlowFiEscrowOracle {
    function getJobForOracle(uint256 jobId) external view returns (
        string memory deliverableUrl,
        string memory requirements
    );
}

contract DeliverableOracle is Ownable {

    bytes[] private _allowedDomains;

    ISomniaLLMParseWebsite public somniaParseAgent;
    address public escrow;
    address public evaluator;
    address public somniaAgent;

    mapping(bytes32 => uint256) public requestToJobId;
    mapping(bytes32 => string)  public scrapedContent;

    string private constant EXTRACTION_PROMPT =
        "Extract the following from this page: "
        "1) title or PR title "
        "2) description or body "
        "3) status (open/merged/closed/approved) "
        "4) file changes summary if present "
        "5) completion indicators. "
        "Return as plain text summary under 500 words.";

    event ParseRequested(bytes32 indexed requestId, uint256 indexed jobId, string url);
    event ParseFulfilled(bytes32 indexed requestId, string content);
    event DomainRejected(uint256 indexed jobId, string url);

    error OnlyEscrow();
    error OnlySomniaAgent();
    error DomainNotAllowed(string url);
    error ZeroAddress();

    constructor(
        address _somniaParseAgent,
        address _somniaAgent
    ) Ownable(msg.sender) {
        if (_somniaParseAgent == address(0)) revert ZeroAddress();
        if (_somniaAgent == address(0)) revert ZeroAddress();
        somniaParseAgent = ISomniaLLMParseWebsite(_somniaParseAgent);
        somniaAgent = _somniaAgent;

        _allowedDomains.push(bytes("github.com"));
        _allowedDomains.push(bytes("notion.so"));
        _allowedDomains.push(bytes("figma.com"));
        _allowedDomains.push(bytes("docs.google.com"));
        _allowedDomains.push(bytes("linear.app"));
    }

    function setEscrow(address _escrow) external onlyOwner {
        if (_escrow == address(0)) revert ZeroAddress();
        escrow = _escrow;
    }

    function setEvaluator(address _evaluator) external onlyOwner {
        if (_evaluator == address(0)) revert ZeroAddress();
        evaluator = _evaluator;
    }

    modifier onlyEscrow() {
        if (msg.sender != escrow) revert OnlyEscrow();
        _;
    }

    modifier onlySomniaAgent() {
        if (msg.sender != somniaAgent) revert OnlySomniaAgent();
        _;
    }

    function requestEvaluation(
        uint256 jobId,
        string calldata url,
        string calldata /*requirements*/
    ) external onlyEscrow returns (bytes32 requestId) {
        if (!_isDomainAllowed(url)) {
            emit DomainRejected(jobId, url);
            revert DomainNotAllowed(url);
        }

        requestId = somniaParseAgent.request(url, EXTRACTION_PROMPT);
        requestToJobId[requestId] = jobId;
        emit ParseRequested(requestId, jobId, url);
    }

    function fulfillParse(
        bytes32 requestId,
        string calldata content
    ) external onlySomniaAgent {
        uint256 jobId = requestToJobId[requestId];
        scrapedContent[requestId] = content;
        emit ParseFulfilled(requestId, content);

        (,string memory requirements) = IFlowFiEscrowOracle(escrow).getJobForOracle(jobId);

        ICompletionEvaluator(evaluator).requestScore(
            requestId,
            content,
            requirements,
            jobId
        );
    }

    function _isDomainAllowed(string calldata url) internal view returns (bool) {
        bytes memory b = bytes(url);

        uint256 start = 0;
        if (b.length > 8 && b[0] == 'h' && b[4] == 's' && b[7] == '/') {
            start = 8;
        } else if (b.length > 7 && b[0] == 'h' && b[4] == ':') {
            start = 7;
        } else {
            return false;
        }

        uint256 end = start;
        while (end < b.length && b[end] != '/') {
            end++;
        }

        bytes memory hostname = new bytes(end - start);
        for (uint256 i = 0; i < end - start; i++) {
            hostname[i] = b[start + i];
        }

        for (uint256 d = 0; d < _allowedDomains.length; d++) {
            bytes memory domain = _allowedDomains[d];
            if (hostname.length >= domain.length) {
                uint256 offset = hostname.length - domain.length;
                bool prefixOk = (offset == 0) || (hostname[offset - 1] == '.');
                if (!prefixOk) continue;
                bool isMatch = true;
                for (uint256 i = 0; i < domain.length; i++) {
                    if (hostname[offset + i] != domain[i]) {
                        isMatch = false;
                        break;
                    }
                }
                if (isMatch) return true;
            }
        }
        return false;
    }
}
