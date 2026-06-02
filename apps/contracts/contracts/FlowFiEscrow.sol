// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ISomnia.sol";

interface IFlowNFT {
    function mintReceipt(address to, uint256 jobId, uint256 score)
        external returns (uint256 tokenId);
}

contract FlowFiEscrow is ReentrancyGuard, Pausable, Ownable {

    enum JobStatus {
        FUNDED,
        SUBMITTED,
        EVALUATING,
        COMPLETE,
        DISPUTED,
        REFUNDED
    }

    struct Job {
        address       client;
        address payable freelancer;
        uint256       amount;
        string        deliverableUrl;
        string        requirements;
        uint256       deadline;
        JobStatus     status;
        uint256       evaluationScore;
        string        evaluationReason;
        uint256       submittedAt;
        uint256       agentRequestId;
    }

    mapping(uint256 => Job)     public jobs;
    mapping(uint256 => uint256) public agentRequestToJobId;
    uint256 public nextJobId;

    IAgentRequester public immutable platform;
    IFlowNFT        public immutable nft;
    uint256         public immutable llmAgentId;
    uint256         public immutable llmCostPerAgent;
    uint256         public constant  SUBCOMMITTEE_SIZE = 3;
    uint256         public constant  TIMEOUT_BUFFER    = 3 days;

    bytes[] private _allowedDomains;

    event JobCreated(uint256 indexed jobId, address client, address freelancer, uint256 amount, uint256 deadline);
    event WorkSubmitted(uint256 indexed jobId, string deliverableUrl, uint256 timestamp);
    event EvaluationRequested(uint256 indexed jobId, uint256 agentRequestId, uint256 depositSent);
    event EvaluationComplete(uint256 indexed jobId, uint256 score, string reason);
    event PaymentReleased(uint256 indexed jobId, address freelancer, uint256 amount, uint256 nftTokenId);
    event PaymentDisputed(uint256 indexed jobId, uint256 score, string reason);
    event PaymentRefunded(uint256 indexed jobId, address client, uint256 amount);
    event AgentTimedOut(uint256 indexed jobId, uint256 agentRequestId);
    event AgentFailed(uint256 indexed jobId, uint256 agentRequestId);
    event NFTMintFailed(uint256 indexed jobId);

    error InvalidAmount();
    error DeadlineInPast();
    error ZeroAddressFreelancer();
    error DomainNotAllowed(string url);
    error NotFreelancer();
    error DeadlinePassed();
    error WrongStatus(JobStatus current);
    error NotClient();
    error NotPlatform();
    error TimeoutNotReached();
    error InsufficientAgentDeposit(uint256 required, uint256 available);
    error UnknownAgentRequest(uint256 requestId);
    error ZeroAddress();

    constructor(
        address _platform,
        address _nft,
        uint256 _llmAgentId,
        uint256 _llmCostPerAgent
    ) Ownable(msg.sender) {
        if (_platform == address(0) || _nft == address(0)) revert ZeroAddress();
        platform        = IAgentRequester(_platform);
        nft             = IFlowNFT(_nft);
        llmAgentId      = _llmAgentId;
        llmCostPerAgent = _llmCostPerAgent;

        _allowedDomains.push(bytes("github.com"));
        _allowedDomains.push(bytes("notion.so"));
        _allowedDomains.push(bytes("figma.com"));
        _allowedDomains.push(bytes("docs.google.com"));
        _allowedDomains.push(bytes("linear.app"));
    }

    receive() external payable {}

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function createJob(
        address freelancer,
        string calldata requirements,
        string calldata deliverableUrl,
        uint256 deadline
    ) external payable whenNotPaused returns (uint256 jobId) {
        if (msg.value == 0)              revert InvalidAmount();
        if (deadline <= block.timestamp) revert DeadlineInPast();
        if (freelancer == address(0))    revert ZeroAddressFreelancer();
        if (!_isDomainAllowed(deliverableUrl)) revert DomainNotAllowed(deliverableUrl);

        jobId = nextJobId++;
        jobs[jobId] = Job({
            client:          msg.sender,
            freelancer:      payable(freelancer),
            amount:          msg.value,
            deliverableUrl:  deliverableUrl,
            requirements:    requirements,
            deadline:        deadline,
            status:          JobStatus.FUNDED,
            evaluationScore: 0,
            evaluationReason:"",
            submittedAt:     0,
            agentRequestId:  0
        });

        emit JobCreated(jobId, msg.sender, freelancer, msg.value, deadline);
    }

    function submitWork(uint256 jobId, string calldata deliverableUrl)
        external whenNotPaused
    {
        Job storage j = jobs[jobId];
        if (msg.sender != j.freelancer)        revert NotFreelancer();
        if (j.status != JobStatus.FUNDED)      revert WrongStatus(j.status);
        if (block.timestamp > j.deadline)      revert DeadlinePassed();
        if (!_isDomainAllowed(deliverableUrl)) revert DomainNotAllowed(deliverableUrl);

        j.deliverableUrl = deliverableUrl;
        j.status         = JobStatus.SUBMITTED;
        j.submittedAt    = block.timestamp;

        emit WorkSubmitted(jobId, deliverableUrl, block.timestamp);
    }

    function invokeEvaluation(uint256 jobId) external whenNotPaused {
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.SUBMITTED) revert WrongStatus(j.status);

        uint256 reserveDeposit = platform.getRequestDeposit();
        uint256 rewardDeposit  = llmCostPerAgent * SUBCOMMITTEE_SIZE;
        uint256 totalDeposit   = reserveDeposit + rewardDeposit;

        if (address(this).balance < totalDeposit) {
            revert InsufficientAgentDeposit(totalDeposit, address(this).balance);
        }

        j.status = JobStatus.EVALUATING;
        j.amount -= totalDeposit;

        string memory prompt = _buildEvalPrompt(j.requirements, j.deliverableUrl);
        bytes memory payload = abi.encode(prompt);

        uint256 agentRequestId = platform.createRequest{value: totalDeposit}(
            llmAgentId,
            address(this),
            this.handleResponse.selector,
            payload
        );

        j.agentRequestId = agentRequestId;
        agentRequestToJobId[agentRequestId] = jobId;

        emit EvaluationRequested(jobId, agentRequestId, totalDeposit);
    }

    function handleResponse(
        uint256 agentRequestId,
        Response[] memory responses,
        ResponseStatus status,
        AgentRequest memory /* details */
    ) external {
        if (msg.sender != address(platform)) revert NotPlatform();

        uint256 jobId = agentRequestToJobId[agentRequestId];
        Job storage j = jobs[jobId];

        if (j.status != JobStatus.EVALUATING) {
            return;
        }

        if (status == ResponseStatus.TimedOut) {
            emit AgentTimedOut(jobId, agentRequestId);
            _refundClient(jobId);
            return;
        }

        if (status == ResponseStatus.Failed) {
            emit AgentFailed(jobId, agentRequestId);
            j.status = JobStatus.DISPUTED;
            j.evaluationReason = "agent_failed";
            emit PaymentDisputed(jobId, 0, "agent_failed");
            return;
        }

        if (responses.length == 0) {
            _refundClient(jobId);
            return;
        }

        bytes memory raw = responses[0].result;
        if (raw.length == 0) {
            _refundClient(jobId);
            return;
        }

        if (responses[0].status != ResponseStatus.Success) {
            bool found = false;
            for (uint256 i = 1; i < responses.length; i++) {
                if (responses[i].status == ResponseStatus.Success) {
                    raw = responses[i].result;
                    found = true;
                    break;
                }
            }
            if (!found) {
                _refundClient(jobId);
                return;
            }
        }

        string memory jsonResponse;
        try this._decodeString(raw) returns (string memory decoded) {
            jsonResponse = decoded;
        } catch {
            j.status = JobStatus.REFUNDED;
            j.evaluationReason = "decode_error";
            _refundClient(jobId);
            return;
        }

        (uint256 score, string memory reason) = _parseScore(jsonResponse);
        j.evaluationScore  = score;
        j.evaluationReason = reason;
        emit EvaluationComplete(jobId, score, reason);

        if (score >= 80) {
            _releasePayment(jobId);
        } else if (score >= 50) {
            j.status = JobStatus.DISPUTED;
            emit PaymentDisputed(jobId, score, reason);
        } else {
            _refundClient(jobId);
        }
    }

    function _decodeString(bytes memory raw) external pure returns (string memory) {
        return string(raw);
    }

    function clientOverride(uint256 jobId, bool approvePayment) external {
        Job storage j = jobs[jobId];
        if (msg.sender != j.client)          revert NotClient();
        if (j.status != JobStatus.DISPUTED)  revert WrongStatus(j.status);

        if (approvePayment) { _releasePayment(jobId); }
        else                { _refundClient(jobId);   }
    }

    function claimRefundAfterTimeout(uint256 jobId) external {
        Job storage j = jobs[jobId];
        if (msg.sender != j.client) revert NotClient();
        if (block.timestamp <= j.deadline + TIMEOUT_BUFFER) revert TimeoutNotReached();
        if (j.status != JobStatus.FUNDED && j.status != JobStatus.SUBMITTED) {
            revert WrongStatus(j.status);
        }
        _refundClient(jobId);
    }

    function _releasePayment(uint256 jobId) internal nonReentrant {
        Job storage j = jobs[jobId];
        uint256 amount        = j.amount;
        address payable to    = j.freelancer;
        uint256 score         = j.evaluationScore;

        j.status = JobStatus.COMPLETE;
        j.amount = 0;

        (bool ok,) = to.call{value: amount}("");
        require(ok, "STT transfer failed");

        uint256 tokenId = 0;
        try nft.mintReceipt(to, jobId, score) returns (uint256 id) {
            tokenId = id;
        } catch {
            emit NFTMintFailed(jobId);
        }

        emit PaymentReleased(jobId, to, amount, tokenId);
    }

    function _refundClient(uint256 jobId) internal nonReentrant {
        Job storage j = jobs[jobId];
        uint256 amount = j.amount;
        address client = j.client;

        j.status = JobStatus.REFUNDED;
        j.amount = 0;

        (bool ok,) = payable(client).call{value: amount}("");
        require(ok, "Refund transfer failed");

        emit PaymentRefunded(jobId, client, amount);
    }

    function _buildEvalPrompt(
        string memory requirements,
        string memory deliverableUrl
    ) internal pure returns (string memory) {
        return string.concat(
            "You are a payment arbitration system evaluating freelance work. ",
            "Score the completion of this project from 0 to 100. ",
            "Requirements: ", requirements, " ",
            "Deliverable URL: ", deliverableUrl, " ",
            "Consider: completeness, quality, and adherence to requirements. ",
            'Respond with ONLY this JSON on one line: {"score":<integer 0-100>,"reason":"<one sentence under 100 chars>"}'
        );
    }

    function _parseScore(string memory json)
        internal pure returns (uint256 score, string memory reason)
    {
        bytes memory b = bytes(json);

        bytes memory scoreKey = bytes('"score":');
        uint256 si = _indexOf(b, scoreKey);
        if (si == type(uint256).max) return (0, "parse_error");

        uint256 numStart = si + scoreKey.length;
        while (numStart < b.length && b[numStart] == ' ') numStart++;
        if (numStart >= b.length) return (0, "parse_error");

        uint256 parsed = 0; bool hasDigit = false;
        uint256 pos = numStart;
        while (pos < b.length && b[pos] >= '0' && b[pos] <= '9') {
            parsed = parsed * 10 + (uint8(b[pos]) - 48);
            pos++; hasDigit = true;
        }
        if (!hasDigit) return (0, "parse_error");
        score = parsed > 100 ? 100 : parsed;

        bytes memory rKey = bytes('"reason":"');
        uint256 ri = _indexOf(b, rKey);
        if (ri == type(uint256).max) return (score, "parse_error");

        uint256 rStart = ri + rKey.length;
        uint256 rEnd   = rStart;
        while (rEnd < b.length && b[rEnd] != '"') {
            if (b[rEnd] == '\\' && rEnd + 1 < b.length) { rEnd += 2; continue; }
            rEnd++;
        }
        if (rEnd >= b.length) return (score, "parse_error");

        bytes memory rb = new bytes(rEnd - rStart);
        for (uint256 i = 0; i < rb.length; i++) rb[i] = b[rStart + i];
        reason = string(rb);
        if (bytes(reason).length == 0) reason = "no_reason";
    }

    function _indexOf(bytes memory hay, bytes memory needle)
        internal pure returns (uint256)
    {
        if (needle.length > hay.length) return type(uint256).max;
        for (uint256 i = 0; i <= hay.length - needle.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (hay[i+j] != needle[j]) { ok = false; break; }
            }
            if (ok) return i;
        }
        return type(uint256).max;
    }

    function _isDomainAllowed(string calldata url) internal view returns (bool) {
        bytes memory b = bytes(url);
        uint256 start = 0;
        if (b.length > 8 && b[4] == 's') start = 8;
        else if (b.length > 7 && b[4] == ':') start = 7;
        else return false;

        uint256 end = start;
        while (end < b.length && b[end] != '/') end++;

        bytes memory host = new bytes(end - start);
        for (uint256 i = 0; i < host.length; i++) host[i] = b[start + i];

        for (uint256 d = 0; d < _allowedDomains.length; d++) {
            bytes memory domain = _allowedDomains[d];
            if (host.length < domain.length) continue;
            uint256 offset = host.length - domain.length;
            if (offset > 0 && host[offset - 1] != '.') continue;
            bool isMatch = true;
            for (uint256 k = 0; k < domain.length; k++) {
                if (host[offset + k] != domain[k]) { isMatch = false; break; }
            }
            if (isMatch) return true;
        }
        return false;
    }
}
