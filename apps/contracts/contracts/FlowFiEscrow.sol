// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IDeliverableOracle {
    function requestEvaluation(
        uint256 jobId,
        string calldata url,
        string calldata requirements
    ) external returns (bytes32 requestId);
}

interface IFlowNFT {
    function mintReceipt(
        address to,
        uint256 jobId,
        uint256 score
    ) external returns (uint256 tokenId);
}

contract FlowFiEscrow is ReentrancyGuard, Pausable, Ownable {

    enum JobStatus { FUNDED, SUBMITTED, EVALUATING, COMPLETE, DISPUTED, REFUNDED }

    struct Job {
        address client;
        address payable freelancer;
        uint256 amount;
        string  deliverableUrl;
        string  requirements;
        uint256 deadline;
        JobStatus status;
        uint256 evaluationScore;
        string  evaluationReason;
        uint256 submittedAt;
    }

    mapping(uint256 => Job) public jobs;
    mapping(bytes32 => uint256) public requestIdToJobId;
    uint256 public nextJobId;

    address public oracle;
    address public evaluator;
    address public nft;

    uint256 private constant TIMEOUT_BUFFER = 3 days;

    event JobCreated(uint256 indexed jobId, address client, address freelancer, uint256 amount, uint256 deadline);
    event WorkSubmitted(uint256 indexed jobId, string deliverableUrl, uint256 timestamp);
    event EvaluationRequested(uint256 indexed jobId, bytes32 requestId);
    event EvaluationComplete(uint256 indexed jobId, uint256 score, string reason);
    event PaymentReleased(uint256 indexed jobId, address freelancer, uint256 amount, uint256 nftTokenId);
    event PaymentDisputed(uint256 indexed jobId, uint256 score);
    event PaymentRefunded(uint256 indexed jobId, address client, uint256 amount);
    event NFTMintFailed_();

    error InvalidAmount();
    error DeadlineInPast();
    error ZeroAddressFreelancer();
    error NotFreelancer();
    error DeadlinePassed();
    error InvalidStatus(JobStatus current, JobStatus required);
    error NotClient();
    error NotEvaluator();
    error TimeoutNotReached();
    error ZeroAddress();

    constructor() Ownable(msg.sender) {}

    function setOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert ZeroAddress();
        oracle = _oracle;
    }

    function setEvaluator(address _evaluator) external onlyOwner {
        if (_evaluator == address(0)) revert ZeroAddress();
        evaluator = _evaluator;
    }

    function setNFT(address _nft) external onlyOwner {
        if (_nft == address(0)) revert ZeroAddress();
        nft = _nft;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function getJobForOracle(uint256 jobId) external view returns (
        string memory deliverableUrl,
        string memory requirements
    ) {
        Job storage j = jobs[jobId];
        return (j.deliverableUrl, j.requirements);
    }

    function createJob(
        address freelancer,
        string calldata requirements,
        string calldata deliverableUrl,
        uint256 deadline
    ) external payable whenNotPaused returns (uint256 jobId) {
        if (msg.value == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert DeadlineInPast();
        if (freelancer == address(0)) revert ZeroAddressFreelancer();

        jobId = nextJobId++;
        jobs[jobId] = Job({
            client: msg.sender,
            freelancer: payable(freelancer),
            amount: msg.value,
            deliverableUrl: deliverableUrl,
            requirements: requirements,
            deadline: deadline,
            status: JobStatus.FUNDED,
            evaluationScore: 0,
            evaluationReason: "",
            submittedAt: 0
        });

        emit JobCreated(jobId, msg.sender, freelancer, msg.value, deadline);
    }

    function submitWork(
        uint256 jobId,
        string calldata deliverableUrl
    ) external whenNotPaused {
        Job storage j = jobs[jobId];
        if (msg.sender != j.freelancer) revert NotFreelancer();
        if (j.status != JobStatus.FUNDED) revert InvalidStatus(j.status, JobStatus.FUNDED);
        if (block.timestamp > j.deadline) revert DeadlinePassed();

        j.deliverableUrl = deliverableUrl;
        j.status = JobStatus.SUBMITTED;
        j.submittedAt = block.timestamp;

        emit WorkSubmitted(jobId, deliverableUrl, block.timestamp);
    }

    function invokeEvaluation(uint256 jobId) external whenNotPaused {
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.SUBMITTED) revert InvalidStatus(j.status, JobStatus.SUBMITTED);

        j.status = JobStatus.EVALUATING;

        bytes32 requestId = IDeliverableOracle(oracle).requestEvaluation(
            jobId,
            j.deliverableUrl,
            j.requirements
        );
        requestIdToJobId[requestId] = jobId;

        emit EvaluationRequested(jobId, requestId);
    }

    function fulfillEvaluation(
        bytes32 requestId,
        uint256 score,
        string calldata reason
    ) external {
        if (msg.sender != evaluator) revert NotEvaluator();

        uint256 jobId = requestIdToJobId[requestId];
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.EVALUATING) revert InvalidStatus(j.status, JobStatus.EVALUATING);

        j.evaluationScore = score;
        j.evaluationReason = reason;
        emit EvaluationComplete(jobId, score, reason);

        if (score >= 80) {
            _releasePayment(jobId);
        } else if (score >= 50) {
            j.status = JobStatus.DISPUTED;
            emit PaymentDisputed(jobId, score);
        } else {
            _refundClient(jobId);
        }
    }

    function clientOverride(uint256 jobId, bool approvePayment) external {
        Job storage j = jobs[jobId];
        if (msg.sender != j.client) revert NotClient();
        if (j.status != JobStatus.DISPUTED) revert InvalidStatus(j.status, JobStatus.DISPUTED);

        if (approvePayment) {
            _releasePayment(jobId);
        } else {
            _refundClient(jobId);
        }
    }

    function claimRefundAfterTimeout(uint256 jobId) external {
        Job storage j = jobs[jobId];
        if (msg.sender != j.client) revert NotClient();
        if (block.timestamp <= j.deadline + TIMEOUT_BUFFER) revert TimeoutNotReached();
        if (j.status != JobStatus.FUNDED && j.status != JobStatus.SUBMITTED) {
            revert InvalidStatus(j.status, JobStatus.FUNDED);
        }
        _refundClient(jobId);
    }

    function _releasePayment(uint256 jobId) internal nonReentrant {
        Job storage j = jobs[jobId];
        uint256 amount = j.amount;
        address payable freelancer = j.freelancer;
        uint256 score = j.evaluationScore;

        j.status = JobStatus.COMPLETE;
        j.amount = 0;

        (bool success, ) = freelancer.call{value: amount}("");
        require(success, "FlowFiEscrow: STT transfer failed");

        uint256 tokenId = 0;
        try IFlowNFT(nft).mintReceipt(freelancer, jobId, score) returns (uint256 id) {
            tokenId = id;
        } catch {
            emit NFTMintFailed_();
        }

        emit PaymentReleased(jobId, freelancer, amount, tokenId);
    }

    function _refundClient(uint256 jobId) internal nonReentrant {
        Job storage j = jobs[jobId];
        uint256 amount = j.amount;
        address client = j.client;

        j.status = JobStatus.REFUNDED;
        j.amount = 0;

        (bool success, ) = payable(client).call{value: amount}("");
        require(success, "FlowFiEscrow: refund transfer failed");

        emit PaymentRefunded(jobId, client, amount);
    }
}
