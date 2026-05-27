import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("FlowFiEscrow — Full State Machine", () => {

  async function deployAll() {
    const [owner, client, freelancer, other] = await ethers.getSigners();

    const FlowNFT = await ethers.getContractFactory("FlowNFT");
    const nft = await FlowNFT.deploy();

    const MockEvaluator = await ethers.getContractFactory("MockEvaluator");
    const evaluator = await MockEvaluator.deploy();

    const MockOracle = await ethers.getContractFactory("MockOracle");
    const oracle = await MockOracle.deploy();

    const FlowFiEscrow = await ethers.getContractFactory("FlowFiEscrow");
    const escrow = await FlowFiEscrow.deploy();

    await escrow.setOracle(await oracle.getAddress());
    await escrow.setEvaluator(await evaluator.getAddress());
    await escrow.setNFT(await nft.getAddress());
    await nft.setMinter(await escrow.getAddress());

    const deadline = (await time.latest()) + 7 * 24 * 3600;
    const amount = ethers.parseEther("1.0");

    return { escrow, nft, oracle, evaluator, owner, client, freelancer, other, deadline, amount };
  }

  describe("createJob", () => {
    it("creates job with correct state and emits JobCreated", async () => {
      const { escrow, client, freelancer, deadline, amount } = await deployAll();
      const tx = await escrow.connect(client).createJob(
        freelancer.address, "Build API", "https://github.com/pr/1", deadline,
        { value: amount }
      );
      await expect(tx).to.emit(escrow, "JobCreated").withArgs(0, client.address, freelancer.address, amount, deadline);
      const job = await escrow.jobs(0);
      expect(job.status).to.equal(0);
      expect(job.amount).to.equal(amount);
    });

    it("reverts if msg.value is 0", async () => {
      const { escrow, client, freelancer, deadline } = await deployAll();
      await expect(
        escrow.connect(client).createJob(freelancer.address, "req", "https://github.com", deadline, { value: 0 })
      ).to.be.revertedWithCustomError(escrow, "InvalidAmount");
    });

    it("reverts if deadline is in the past", async () => {
      const { escrow, client, freelancer, amount } = await deployAll();
      const pastDeadline = (await time.latest()) - 1;
      await expect(
        escrow.connect(client).createJob(freelancer.address, "req", "https://github.com", pastDeadline, { value: amount })
      ).to.be.revertedWithCustomError(escrow, "DeadlineInPast");
    });

    it("reverts if freelancer is zero address", async () => {
      const { escrow, client, deadline, amount } = await deployAll();
      await expect(
        escrow.connect(client).createJob(ethers.ZeroAddress, "req", "https://github.com", deadline, { value: amount })
      ).to.be.revertedWithCustomError(escrow, "ZeroAddressFreelancer");
    });
  });

  describe("submitWork", () => {
    async function fundedJob() {
      const d = await deployAll();
      await d.escrow.connect(d.client).createJob(
        d.freelancer.address, "Build API", "https://github.com/pr/1", d.deadline, { value: d.amount }
      );
      return d;
    }

    it("transitions status to SUBMITTED and emits WorkSubmitted", async () => {
      const { escrow, freelancer } = await fundedJob();
      const tx = await escrow.connect(freelancer).submitWork(0, "https://github.com/pr/2");
      await expect(tx).to.emit(escrow, "WorkSubmitted").withArgs(0, "https://github.com/pr/2", await time.latest());
      const job = await escrow.jobs(0);
      expect(job.status).to.equal(1);
    });

    it("reverts if called by non-freelancer", async () => {
      const { escrow, other } = await fundedJob();
      await expect(escrow.connect(other).submitWork(0, "https://github.com/pr/2"))
        .to.be.revertedWithCustomError(escrow, "NotFreelancer");
    });

    it("reverts if called after deadline", async () => {
      const { escrow, freelancer, deadline } = await fundedJob();
      await time.increaseTo(deadline + 1);
      await expect(escrow.connect(freelancer).submitWork(0, "https://github.com/pr/2"))
        .to.be.revertedWithCustomError(escrow, "DeadlinePassed");
    });

    it("reverts if job not in FUNDED state", async () => {
      const { escrow, freelancer } = await fundedJob();
      await escrow.connect(freelancer).submitWork(0, "https://github.com/pr/2");
      await expect(escrow.connect(freelancer).submitWork(0, "https://github.com/pr/3"))
        .to.be.revertedWithCustomError(escrow, "InvalidStatus");
    });
  });

  describe("fulfillEvaluation — score >= 80", () => {
    async function evaluatingJob() {
      const d = await deployAll();
      await d.escrow.connect(d.client).createJob(
        d.freelancer.address, "req", "https://github.com/pr/1", d.deadline, { value: d.amount }
      );
      await d.escrow.connect(d.freelancer).submitWork(0, "https://github.com/pr/2");
      await d.escrow.invokeEvaluation(0);
      return d;
    }

    it("releases payment and mints NFT on score >= 80", async () => {
      const { escrow, evaluator, nft, freelancer, amount } = await evaluatingJob();
      const balanceBefore = await ethers.provider.getBalance(freelancer.address);
      const lastRequestId = await evaluator.lastRequestId();

      await evaluator.mockFulfill(await escrow.getAddress(), lastRequestId, 85, "Excellent");

      const job = await escrow.jobs(0);
      expect(job.status).to.equal(3);
      expect(job.amount).to.equal(0);

      const balanceAfter = await ethers.provider.getBalance(freelancer.address);
      expect(balanceAfter - balanceBefore).to.equal(amount);
      expect(await nft.balanceOf(freelancer.address)).to.equal(1);
    });

    it("reverts if called by non-evaluator", async () => {
      const { escrow, other } = await evaluatingJob();
      await expect(escrow.connect(other).fulfillEvaluation(ethers.id("x"), 90, "ok"))
        .to.be.revertedWithCustomError(escrow, "NotEvaluator");
    });
  });

  describe("fulfillEvaluation — score 50-79", () => {
    it("sets status DISPUTED, does not transfer funds", async () => {
      const d = await deployAll();
      await d.escrow.connect(d.client).createJob(
        d.freelancer.address, "req", "https://github.com/pr/1", d.deadline, { value: d.amount }
      );
      await d.escrow.connect(d.freelancer).submitWork(0, "https://github.com/pr/2");
      await d.escrow.invokeEvaluation(0);
      const lastRequestId = await d.evaluator.lastRequestId();
      await d.evaluator.mockFulfill(await d.escrow.getAddress(), lastRequestId, 65, "Partial");
      const job = await d.escrow.jobs(0);
      expect(job.status).to.equal(4);
      expect(job.amount).to.equal(d.amount);
    });
  });

  describe("fulfillEvaluation — score < 50", () => {
    it("refunds client and sets REFUNDED", async () => {
      const d = await deployAll();
      await d.escrow.connect(d.client).createJob(
        d.freelancer.address, "req", "https://github.com/pr/1", d.deadline, { value: d.amount }
      );
      await d.escrow.connect(d.freelancer).submitWork(0, "https://github.com/pr/2");
      await d.escrow.invokeEvaluation(0);
      const lastRequestId = await d.evaluator.lastRequestId();
      const balanceBefore = await ethers.provider.getBalance(d.client.address);
      await d.evaluator.mockFulfill(await d.escrow.getAddress(), lastRequestId, 30, "Incomplete");
      const job = await d.escrow.jobs(0);
      expect(job.status).to.equal(5);
      const balanceAfter = await ethers.provider.getBalance(d.client.address);
      expect(balanceAfter - balanceBefore).to.equal(d.amount);
    });
  });

  describe("claimRefundAfterTimeout", () => {
    it("allows client to claim refund after deadline + 3 days", async () => {
      const d = await deployAll();
      await d.escrow.connect(d.client).createJob(
        d.freelancer.address, "req", "https://github.com/pr/1", d.deadline, { value: d.amount }
      );
      await time.increaseTo(d.deadline + 3 * 24 * 3600 + 1);
      const balanceBefore = await ethers.provider.getBalance(d.client.address);
      const tx = await d.escrow.connect(d.client).claimRefundAfterTimeout(0);
      await tx.wait();
      const balanceAfter = await ethers.provider.getBalance(d.client.address);
      expect(balanceAfter).to.be.greaterThan(balanceBefore);
      const job = await d.escrow.jobs(0);
      expect(job.status).to.equal(5);
    });

    it("reverts before timeout period", async () => {
      const d = await deployAll();
      await d.escrow.connect(d.client).createJob(
        d.freelancer.address, "req", "https://github.com/pr/1", d.deadline, { value: d.amount }
      );
      await expect(d.escrow.connect(d.client).claimRefundAfterTimeout(0))
        .to.be.revertedWithCustomError(d.escrow, "TimeoutNotReached");
    });

    it("reverts if called by non-client", async () => {
      const d = await deployAll();
      await d.escrow.connect(d.client).createJob(
        d.freelancer.address, "req", "https://github.com/pr/1", d.deadline, { value: d.amount }
      );
      await time.increaseTo(d.deadline + 3 * 24 * 3600 + 1);
      await expect(d.escrow.connect(d.freelancer).claimRefundAfterTimeout(0))
        .to.be.revertedWithCustomError(d.escrow, "NotClient");
    });
  });

  describe("clientOverride", () => {
    async function disputedJob() {
      const d = await deployAll();
      await d.escrow.connect(d.client).createJob(
        d.freelancer.address, "req", "https://github.com/pr/1", d.deadline, { value: d.amount }
      );
      await d.escrow.connect(d.freelancer).submitWork(0, "https://github.com/pr/2");
      await d.escrow.invokeEvaluation(0);
      const lastRequestId = await d.evaluator.lastRequestId();
      await d.evaluator.mockFulfill(await d.escrow.getAddress(), lastRequestId, 65, "Partial");
      return d;
    }

    it("approvePayment releases funds", async () => {
      const d = await disputedJob();
      const balanceBefore = await ethers.provider.getBalance(d.freelancer.address);
      await d.escrow.connect(d.client).clientOverride(0, true);
      const balanceAfter = await ethers.provider.getBalance(d.freelancer.address);
      expect(balanceAfter - balanceBefore).to.equal(d.amount);
      const job = await d.escrow.jobs(0);
      expect(job.status).to.equal(3);
    });

    it("reject refunds client", async () => {
      const d = await disputedJob();
      const clientBalanceBefore = await ethers.provider.getBalance(d.client.address);
      const freelancerBalanceBefore = await ethers.provider.getBalance(d.freelancer.address);
      await d.escrow.connect(d.client).clientOverride(0, false);
      const clientBalanceAfter = await ethers.provider.getBalance(d.client.address);
      const freelancerBalanceAfter = await ethers.provider.getBalance(d.freelancer.address);
      expect(clientBalanceAfter).to.be.greaterThan(clientBalanceBefore);
      expect(freelancerBalanceAfter).to.equal(freelancerBalanceBefore);
      const job = await d.escrow.jobs(0);
      expect(job.status).to.equal(5);
    });

    it("reverts if called by non-client", async () => {
      const d = await disputedJob();
      await expect(d.escrow.connect(d.freelancer).clientOverride(0, true))
        .to.be.revertedWithCustomError(d.escrow, "NotClient");
    });
  });

  describe("reentrancy protection", () => {
    it("blocks reentrant releasePayment via malicious recipient", async () => {
      const [owner, client] = await ethers.getSigners();

      const FlowNFT = await ethers.getContractFactory("FlowNFT");
      const nft = await FlowNFT.deploy();
      const MockEvaluator = await ethers.getContractFactory("MockEvaluator");
      const evaluator = await MockEvaluator.deploy();
      const MockOracle = await ethers.getContractFactory("MockOracle");
      const oracle = await MockOracle.deploy();
      const MaliciousFreelancer = await ethers.getContractFactory("MaliciousFreelancer");
      const malicious = await MaliciousFreelancer.deploy();

      const FlowFiEscrow = await ethers.getContractFactory("FlowFiEscrow");
      const escrow = await FlowFiEscrow.deploy();

      await escrow.setOracle(await oracle.getAddress());
      await escrow.setEvaluator(await evaluator.getAddress());
      await escrow.setNFT(await nft.getAddress());
      await nft.setMinter(await escrow.getAddress());
      await malicious.setEscrow(await escrow.getAddress());

      const deadline = (await time.latest()) + 86400;
      const amount = ethers.parseEther("1.0");
      await escrow.connect(client).createJob(
        await malicious.getAddress(), "req", "https://github.com/pr/1", deadline, { value: amount }
      );
      await malicious.doSubmitAndTrigger(0);

      const lastRequestId = await evaluator.lastRequestId();
      await evaluator.mockFulfill(await escrow.getAddress(), lastRequestId, 90, "test");

      expect(await malicious.reentryAttempted()).to.equal(true);
      expect(await malicious.reentrySucceeded()).to.equal(false);
    });
  });
});
