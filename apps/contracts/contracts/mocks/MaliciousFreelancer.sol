// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEscrow {
    function submitWork(uint256 jobId, string calldata deliverableUrl) external;
    function invokeEvaluation(uint256 jobId) external;
    function claimRefundAfterTimeout(uint256 jobId) external;
}

contract MaliciousFreelancer {
    address public escrow;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    function setEscrow(address _escrow) external {
        escrow = _escrow;
    }

    function doSubmitAndTrigger(uint256 jobId) external {
        IEscrow(escrow).submitWork(jobId, "https://github.com/malicious");
        IEscrow(escrow).invokeEvaluation(jobId);
    }

    receive() external payable {
        reentryAttempted = true;
        if (escrow != address(0)) {
            (bool success, ) = escrow.call{gas: 50000}(
                abi.encodeWithSignature("claimRefundAfterTimeout(uint256)", 0)
            );
            reentrySucceeded = success;
        }
    }
}
