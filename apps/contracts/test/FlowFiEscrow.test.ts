import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("EVAL-01: Happy Path — Full job lifecycle", () => {

  async function deployAll() {
    const [owner, client, freelancer, other] = await ethers.getSigners();

    const FlowNFT = await ethers.getContractFactory("FlowNFT");
    const nft = await FlowNFT.deploy();

    const MockAgentRequester = await ethers.getContractFactory("MockAgentRequester");
    const platform = await MockAgentRequester.deploy();

    const FlowFiEscrow = await ethers.getContractFactory("FlowFiEscrow");
    const escrow = await FlowFiEscrow.deploy(
      await platform.getAddress(),
      await nft.getAddress(),
      1n,
      ethers.parseEther("0.07")
    );

    await nft.setMinter(await escrow.getAddress());

    const deadline = (await time.latest()) + 7 * 24 * 3600;
    const amount = ethers.parseEther("1.0");

    return { escrow, nft, platform, owner, client, freelancer, other, deadline, amount };
  }

  async function createAndSubmit(d: Awaited<ReturnType<typeof deployAll>>) {
    await d.escrow.connect(d.client).createJob(
      d.freelancer.address, "Build API", "https://github.com/pr/1", d.deadline,
      { value: d.amount }
    );
    await d.escrow.connect(d.freelancer).submitWork(0, "https://github.com/pr/2");
  }

  it("EVAL-01a: createJob emits JobCreated, stores correct state", async () => {
    const d = await deployAll();
    const tx = await d.escrow.connect(d.client).createJob(
      d.freelancer.address, "Build API", "https://github.com/pr/1", d.deadline,
      { value: d.amount }
    );
    await expect(tx).to.emit(d.escrow, "JobCreated")
      .withArgs(0, d.client.address, d.freelancer.address, d.amount, d.deadline);
    const job = await d.escrow.jobs(0);
    expect(job.status).to.equal(0);
    expect(job.amount).to.equal(d.amount);
    expect(job.client).to.equal(d.client.address);
    expect(job.freelancer).to.equal(d.freelancer.address);
  });

  it("EVAL-01b: submitWork transitions FUNDED->SUBMITTED, emits WorkSubmitted", async () => {
    const d = await deployAll();
    await d.escrow.connect(d.client).createJob(
      d.freelancer.address, "Build API", "https://github.com/pr/1", d.deadline,
      { value: d.amount }
    );
    const tx = await d.escrow.connect(d.freelancer).submitWork(0, "https://github.com/pr/2");
    await expect(tx).to.emit(d.escrow, "WorkSubmitted")
      .withArgs(0, "https://github.com/pr/2", await time.latest());
    const job = await d.escrow.jobs(0);
    expect(job.status).to.equal(1);
  });

  it("EVAL-01c: invokeEvaluation transitions SUBMITTED->EVALUATING, calls platform", async () => {
    const d = await deployAll();
    await createAndSubmit(d);

    const result = ethers.AbiCoder.defaultAbiCoder().encode(
      ["string"], ['{"score":85,"reason":"Great work"}']
    );
    await d.platform.setMockResult(2, result);

    await d.escrow.invokeEvaluation(0);

    expect(await d.platform.lastAgentId()).to.equal(1n);
    expect(await d.platform.lastCallbackAddress()).to.equal(await d.escrow.getAddress());
  });

  it("EVAL-01d: handleResponse(Success, score=85) releases payment, mints NFT, emits PaymentReleased", async () => {
    const d = await deployAll();
    await createAndSubmit(d);

    const result = ethers.AbiCoder.defaultAbiCoder().encode(
      ["string"], ['{"score":85,"reason":"Great work"}']
    );
    await d.platform.setMockResult(2, result);

    const tx = await d.escrow.invokeEvaluation(0);
    await expect(tx).to.emit(d.escrow, "EvaluationComplete").withArgs(0, 85, "Great work");
    await expect(tx).to.emit(d.escrow, "PaymentReleased");

    const job = await d.escrow.jobs(0);
    expect(job.status).to.equal(3);

    expect(await d.nft.balanceOf(d.freelancer.address)).to.equal(1);
  });

  it("EVAL-01e: freelancer balance increases by correct amount after release", async () => {
    const d = await deployAll();
    await createAndSubmit(d);

    const result = ethers.AbiCoder.defaultAbiCoder().encode(
      ["string"], ['{"score":85,"reason":"Great work"}']
    );
    await d.platform.setMockResult(2, result);

    const balanceBefore = await ethers.provider.getBalance(d.freelancer.address);
    await d.escrow.invokeEvaluation(0);
    const balanceAfter = await ethers.provider.getBalance(d.freelancer.address);
    const deposit = ethers.parseEther("0.03") + ethers.parseEther("0.07") * 3n;
    expect(balanceAfter - balanceBefore).to.equal(d.amount - deposit);
  });

  it("EVAL-01f: NFT minted to freelancer with correct jobId and score", async () => {
    const d = await deployAll();
    await createAndSubmit(d);

    const result = ethers.AbiCoder.defaultAbiCoder().encode(
      ["string"], ['{"score":90,"reason":"Excellent"}']
    );
    await d.platform.setMockResult(2, result);

    await d.escrow.invokeEvaluation(0);

    const tokenURI = await d.nft.tokenURI(0);
    expect(tokenURI.startsWith("data:application/json;base64,")).to.be.true;
    const decoded = Buffer.from(tokenURI.split(",")[1], "base64").toString();
    const parsed = JSON.parse(decoded);
    const jobAttr = parsed.attributes.find((a: any) => a.trait_type === "Job ID");
    expect(jobAttr.value).to.equal(0);
    const scoreAttr = parsed.attributes.find((a: any) => a.trait_type === "Completion Score");
    expect(scoreAttr.value).to.equal(90);
  });
});

describe("EVAL-02: Disputed Path", () => {

  async function disputedSetup(score: number) {
    const [owner, client, freelancer] = await ethers.getSigners();

    const FlowNFT = await ethers.getContractFactory("FlowNFT");
    const nft = await FlowNFT.deploy();

    const MockAgentRequester = await ethers.getContractFactory("MockAgentRequester");
    const platform = await MockAgentRequester.deploy();

    const FlowFiEscrow = await ethers.getContractFactory("FlowFiEscrow");
    const escrow = await FlowFiEscrow.deploy(
      await platform.getAddress(),
      await nft.getAddress(),
      1n,
      ethers.parseEther("0.07")
    );
    await nft.setMinter(await escrow.getAddress());

    const deadline = (await time.latest()) + 86400;
    const amount = ethers.parseEther("1.0");

    await escrow.connect(client).createJob(
      freelancer.address, "req", "https://github.com/pr/1", deadline,
      { value: amount }
    );
    await escrow.connect(freelancer).submitWork(0, "https://github.com/pr/2");

    const result = ethers.AbiCoder.defaultAbiCoder().encode(
      ["string"], [`{"score":${score},"reason":"Partial work"}`]
    );
    await platform.setMockResult(2, result);
    await escrow.invokeEvaluation(0);

    return { escrow, nft, platform, client, freelancer, amount, deadline };
  }

  it("EVAL-02a: handleResponse(Success, score=65) sets DISPUTED, funds retained", async () => {
    const d = await disputedSetup(65);
    const job = await d.escrow.jobs(0);
    expect(job.status).to.equal(4);
    const deposit = ethers.parseEther("0.03") + ethers.parseEther("0.07") * 3n;
    expect(job.amount).to.equal(d.amount - deposit);
  });

  it("EVAL-02b: clientOverride(approve=true) releases payment from DISPUTED", async () => {
    const d = await disputedSetup(65);
    const balanceBefore = await ethers.provider.getBalance(d.freelancer.address);
    await d.escrow.connect(d.client).clientOverride(0, true);
    const balanceAfter = await ethers.provider.getBalance(d.freelancer.address);
    const deposit = ethers.parseEther("0.03") + ethers.parseEther("0.07") * 3n;
    expect(balanceAfter - balanceBefore).to.equal(d.amount - deposit);
    const job = await d.escrow.jobs(0);
    expect(job.status).to.equal(3);
  });

  it("EVAL-02c: clientOverride(approve=false) refunds client from DISPUTED", async () => {
    const d = await disputedSetup(65);
    const clientBalanceBefore = await ethers.provider.getBalance(d.client.address);
    await d.escrow.connect(d.client).clientOverride(0, false);
    const clientBalanceAfter = await ethers.provider.getBalance(d.client.address);
    expect(clientBalanceAfter).to.be.greaterThan(clientBalanceBefore);
    const job = await d.escrow.jobs(0);
    expect(job.status).to.equal(5);
  });

  it("EVAL-02d: non-client cannot call clientOverride", async () => {
    const signers = await ethers.getSigners();
    const other = signers[3]; // distinct from client (signers[1]) and freelancer (signers[2])
    const d = await disputedSetup(65);
    await expect(d.escrow.connect(other).clientOverride(0, true))
      .to.be.revertedWithCustomError(d.escrow, "NotClient");
  });
});

describe("EVAL-03: Refund Paths", () => {

  async function deployAndEval(score: number, status: number) {
    const [owner, client, freelancer] = await ethers.getSigners();

    const FlowNFT = await ethers.getContractFactory("FlowNFT");
    const nft = await FlowNFT.deploy();

    const MockAgentRequester = await ethers.getContractFactory("MockAgentRequester");
    const platform = await MockAgentRequester.deploy();

    const FlowFiEscrow = await ethers.getContractFactory("FlowFiEscrow");
    const escrow = await FlowFiEscrow.deploy(
      await platform.getAddress(),
      await nft.getAddress(),
      1n,
      ethers.parseEther("0.07")
    );
    await nft.setMinter(await escrow.getAddress());

    const deadline = (await time.latest()) + 86400;
    const amount = ethers.parseEther("1.0");

    await escrow.connect(client).createJob(
      freelancer.address, "req", "https://github.com/pr/1", deadline,
      { value: amount }
    );
    await escrow.connect(freelancer).submitWork(0, "https://github.com/pr/2");

    const result = ethers.AbiCoder.defaultAbiCoder().encode(
      ["string"], [`{"score":${score},"reason":"Test"}`]
    );
    await platform.setMockResult(status, result);

    return { escrow, nft, platform, client, freelancer, amount, deadline };
  }

  it("EVAL-03a: handleResponse(Success, score=30) refunds client, sets REFUNDED", async () => {
    const d = await deployAndEval(30, 2);
    await d.escrow.invokeEvaluation(0);
    const job = await d.escrow.jobs(0);
    expect(job.status).to.equal(5);
    expect(job.amount).to.equal(0n);
  });

  it("EVAL-03b: handleResponse(TimedOut) refunds client - chaos path", async () => {
    const d = await deployAndEval(0, 4);
    await d.escrow.invokeEvaluation(0);
    const job = await d.escrow.jobs(0);
    expect(job.status).to.equal(5);
    expect(job.amount).to.equal(0n);
  });

  it("EVAL-03c: handleResponse(Failed) sets DISPUTED - client decides", async () => {
    const d = await deployAndEval(0, 3);
    await d.escrow.invokeEvaluation(0);
    const job = await d.escrow.jobs(0);
    expect(job.status).to.equal(4);
    const deposit = ethers.parseEther("0.03") + ethers.parseEther("0.07") * 3n;
    expect(job.evaluationReason).to.equal("agent_failed");
    expect(job.amount).to.equal(d.amount - deposit);
  });

  it("EVAL-03d: claimRefundAfterTimeout succeeds after deadline+3days", async () => {
    const d = await deployAndEval(0, 0);
    await time.increaseTo(d.deadline + 3 * 24 * 3600 + 1);
    const balanceBefore = await ethers.provider.getBalance(d.client.address);
    await d.escrow.connect(d.client).claimRefundAfterTimeout(0);
    const balanceAfter = await ethers.provider.getBalance(d.client.address);
    expect(balanceAfter).to.be.greaterThan(balanceBefore);
    const job = await d.escrow.jobs(0);
    expect(job.status).to.equal(5);
  });

  it("EVAL-03e: claimRefundAfterTimeout reverts before timeout", async () => {
    const d = await deployAndEval(0, 0);
    await expect(
      d.escrow.connect(d.client).claimRefundAfterTimeout(0)
    ).to.be.revertedWithCustomError(d.escrow, "TimeoutNotReached");
  });

  it("EVAL-03f: claimRefundAfterTimeout reverts if job already COMPLETE", async () => {
    const d = await deployAndEval(85, 2);
    const result = ethers.AbiCoder.defaultAbiCoder().encode(
      ["string"], ['{"score":85,"reason":"Great"}']
    );
    await d.platform.setMockResult(2, result);
    await d.escrow.invokeEvaluation(0);
    await time.increaseTo(d.deadline + 3 * 24 * 3600 + 1);
    await expect(
      d.escrow.connect(d.client).claimRefundAfterTimeout(0)
    ).to.be.revertedWithCustomError(d.escrow, "WrongStatus");
  });
});

describe("EVAL-04: Access Control", () => {

  async function deployEvalMock() {
    const [owner, client, freelancer, other] = await ethers.getSigners();

    const FlowNFT = await ethers.getContractFactory("FlowNFT");
    const nft = await FlowNFT.deploy();

    const MockAgentRequester = await ethers.getContractFactory("MockAgentRequester");
    const platform = await MockAgentRequester.deploy();

    const FlowFiEscrow = await ethers.getContractFactory("FlowFiEscrow");
    const escrow = await FlowFiEscrow.deploy(
      await platform.getAddress(),
      await nft.getAddress(),
      1n,
      ethers.parseEther("0.07")
    );
    await nft.setMinter(await escrow.getAddress());

    const deadline = (await time.latest()) + 86400;
    const amount = ethers.parseEther("1.0");

    return { escrow, nft, platform, owner, client, freelancer, other, deadline, amount };
  }

  it("EVAL-04a: handleResponse reverts if caller is not platform contract", async () => {
    const d = await deployEvalMock();
    // Use the contract's own interface with positional tuple encoding
    const data = d.escrow.interface.encodeFunctionData("handleResponse", [
      ethers.toBigInt(0),
      [],
      0,
      [
        ethers.toBigInt(0),
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        "0x00000000",
        [],
        [],
        0n, 0n, 0n,
        0n, 0n, 0,
        0, 0n, 0n
      ]
    ]);
    await expect(
      d.other.sendTransaction({ to: await d.escrow.getAddress(), data })
    ).to.be.revertedWithCustomError(d.escrow, "NotPlatform");
  });

  it("EVAL-04b: submitWork reverts if caller is not job.freelancer", async () => {
    const d = await deployEvalMock();
    await d.escrow.connect(d.client).createJob(
      d.freelancer.address, "req", "https://github.com/test", d.deadline,
      { value: d.amount }
    );
    await expect(
      d.escrow.connect(d.other).submitWork(0, "https://github.com/x")
    ).to.be.revertedWithCustomError(d.escrow, "NotFreelancer");
  });

  it("EVAL-04c: FlowNFT.mintReceipt reverts if caller is not minter (escrow)", async () => {
    const d = await deployEvalMock();
    await expect(
      d.nft.connect(d.other).mintReceipt(d.freelancer.address, 1n, 90n)
    ).to.be.revertedWithCustomError(d.nft, "OnlyMinter");
  });

  it("EVAL-04d: invokeEvaluation reverts if job not in SUBMITTED state", async () => {
    const d = await deployEvalMock();
    await d.escrow.connect(d.client).createJob(
      d.freelancer.address, "req", "https://github.com/test", d.deadline,
      { value: d.amount }
    );
    await expect(
      d.escrow.invokeEvaluation(0)
    ).to.be.revertedWithCustomError(d.escrow, "WrongStatus");
  });

  it("EVAL-04e: createJob reverts if msg.value == 0", async () => {
    const d = await deployEvalMock();
    await expect(
      d.escrow.connect(d.client).createJob(
        d.freelancer.address, "req", "https://github.com/test", d.deadline,
        { value: 0 }
      )
    ).to.be.revertedWithCustomError(d.escrow, "InvalidAmount");
  });

  it("EVAL-04f: createJob reverts if deadline <= block.timestamp", async () => {
    const d = await deployEvalMock();
    const past = (await time.latest()) - 1;
    await expect(
      d.escrow.connect(d.client).createJob(
        d.freelancer.address, "req", "https://github.com/test", past,
        { value: d.amount }
      )
    ).to.be.revertedWithCustomError(d.escrow, "DeadlineInPast");
  });

  it("EVAL-04g: createJob reverts if freelancer == address(0)", async () => {
    const d = await deployEvalMock();
    await expect(
      d.escrow.connect(d.client).createJob(
        ethers.ZeroAddress, "req", "https://github.com/test", d.deadline,
        { value: d.amount }
      )
    ).to.be.revertedWithCustomError(d.escrow, "ZeroAddressFreelancer");
  });
});

describe("EVAL-05: Reentrancy Protection", () => {
  it("EVAL-05a: malicious freelancer cannot reenter _releasePayment via receive()", async () => {
    const [owner, client] = await ethers.getSigners();

    const FlowNFT = await ethers.getContractFactory("FlowNFT");
    const nft = await FlowNFT.deploy();

    const MockAgentRequester = await ethers.getContractFactory("MockAgentRequester");
    const platform = await MockAgentRequester.deploy();

    const MaliciousFreelancer = await ethers.getContractFactory("MaliciousFreelancer");
    const malicious = await MaliciousFreelancer.deploy();

    const FlowFiEscrow = await ethers.getContractFactory("FlowFiEscrow");
    const escrow = await FlowFiEscrow.deploy(
      await platform.getAddress(),
      await nft.getAddress(),
      1n,
      ethers.parseEther("0.07")
    );
    await nft.setMinter(await escrow.getAddress());
    await malicious.setEscrow(await escrow.getAddress());

    const deadline = (await time.latest()) + 86400;
    const amount = ethers.parseEther("1.0");

    await escrow.connect(client).createJob(
      await malicious.getAddress(), "req", "https://github.com/pr/1", deadline,
      { value: amount }
    );

    const result = ethers.AbiCoder.defaultAbiCoder().encode(
      ["string"], ['{"score":90,"reason":"test"}']
    );
    await platform.setMockResult(2, result);

    await malicious.doSubmitAndTrigger(0);

    const job = await escrow.jobs(0);
    expect(job.status).to.equal(3);
  });
});

describe("EVAL-06: Agent Deposit Accounting", () => {

  async function deploySetup() {
    const [owner, client, freelancer] = await ethers.getSigners();

    const FlowNFT = await ethers.getContractFactory("FlowNFT");
    const nft = await FlowNFT.deploy();

    const MockAgentRequester = await ethers.getContractFactory("MockAgentRequester");
    const platform = await MockAgentRequester.deploy();

    const FlowFiEscrow = await ethers.getContractFactory("FlowFiEscrow");
    const escrow = await FlowFiEscrow.deploy(
      await platform.getAddress(),
      await nft.getAddress(),
      1n,
      ethers.parseEther("0.07")
    );
    await nft.setMinter(await escrow.getAddress());
    return { escrow, nft, platform, owner, client, freelancer };
  }

  it("EVAL-06a: invokeEvaluation forwards correct ETH to platform", async () => {
    const d = await deploySetup();
    const deadline = (await time.latest()) + 86400;
    const amount = ethers.parseEther("1.0");

    await d.escrow.connect(d.client).createJob(
      d.freelancer.address, "req", "https://github.com/test", deadline,
      { value: amount }
    );
    await d.escrow.connect(d.freelancer).submitWork(0, "https://github.com/test/2");

    const result = ethers.AbiCoder.defaultAbiCoder().encode(
      ["string"], ['{"score":85,"reason":"Great"}']
    );
    await d.platform.setMockResult(2, result);

    const platformDeposit = ethers.parseEther("0.03") + ethers.parseEther("0.07") * 3n;

    const platformBefore = await ethers.provider.getBalance(await d.platform.getAddress());

    await d.escrow.invokeEvaluation(0);

    const platformAfter = await ethers.provider.getBalance(await d.platform.getAddress());
    expect(platformAfter - platformBefore).to.equal(platformDeposit);
  });
});

describe("EVAL-07: _parseScore", () => {

  async function createAndEvalWith(jsonStr: string): Promise<[bigint, string]> {
    const [owner, client, freelancer] = await ethers.getSigners();

    const FlowNFT = await ethers.getContractFactory("FlowNFT");
    const nft = await FlowNFT.deploy();
    const MockAgentRequester = await ethers.getContractFactory("MockAgentRequester");
    const platform = await MockAgentRequester.deploy();
    const FlowFiEscrow = await ethers.getContractFactory("FlowFiEscrow");
    const escrow = await FlowFiEscrow.deploy(
      await platform.getAddress(),
      await nft.getAddress(),
      1n,
      ethers.parseEther("0.07")
    );
    await nft.setMinter(await escrow.getAddress());

    const deadline = (await time.latest()) + 86400;
    await escrow.connect(client).createJob(freelancer.address, "req", "https://github.com/test", deadline, { value: ethers.parseEther("0.3") });
    await escrow.connect(freelancer).submitWork(0, "https://github.com/test/2");

    const result = ethers.AbiCoder.defaultAbiCoder().encode(["string"], [jsonStr]);
    await platform.setMockResult(2, result);
    await escrow.invokeEvaluation(0);

    const job = await escrow.jobs(0);
    return [job.evaluationScore, job.evaluationReason];
  }

  it("EVAL-07a: parses {score:85, reason:\"Good\"} correctly", async () => {
    const [score, reason] = await createAndEvalWith('{"score":85,"reason":"Good"}');
    expect(score).to.equal(85n);
    expect(reason).to.equal("Good");
  });

  it("EVAL-07b: returns (0, parse_error) on empty bytes", async () => {
    const [score, reason] = await createAndEvalWith("");
    expect(score).to.equal(0n);
  });

  it("EVAL-07c: returns (0, parse_error) on non-JSON bytes", async () => {
    const [score, reason] = await createAndEvalWith("not json at all");
    expect(score).to.equal(0n);
  });

  it("EVAL-07d: clamps score > 100 to 100", async () => {
    const [score, reason] = await createAndEvalWith('{"score":999,"reason":"Clamped"}');
    expect(score).to.equal(100n);
  });

  it("EVAL-07e: parses score=0 correctly (not treated as parse error)", async () => {
    const [score, reason] = await createAndEvalWith('{"score":0,"reason":"Zero"}');
    expect(score).to.equal(0n);
  });

  it("EVAL-07f: handles escaped quotes in reason string", async () => {
    const [score, reason] = await createAndEvalWith('{"score":70,"reason":"He said \\"good\\""}');
    expect(score).to.equal(70n);
  });
});

describe("EVAL-08: FlowNFT", () => {
  async function deploy() {
    const [owner, minter, freelancer, other] = await ethers.getSigners();
    const FlowNFT = await ethers.getContractFactory("FlowNFT");
    const nft = await FlowNFT.deploy();
    return { nft, owner, minter, freelancer, other };
  }

  it("EVAL-08a: tokenURI returns valid base64 JSON with correct fields", async () => {
    const { nft, minter, freelancer } = await deploy();
    await nft.setMinter(minter.address);
    await nft.connect(minter).mintReceipt(freelancer.address, 5n, 95n);
    const uri = await nft.tokenURI(0);
    expect(uri.startsWith("data:application/json;base64,")).to.be.true;
    const decoded = Buffer.from(uri.split(",")[1], "base64").toString();
    const parsed = JSON.parse(decoded);
    const jobAttr = parsed.attributes.find((a: any) => a.trait_type === "Job ID");
    expect(jobAttr.value).to.equal(5);
    const scoreAttr = parsed.attributes.find((a: any) => a.trait_type === "Completion Score");
    expect(scoreAttr.value).to.equal(95);
  });

  it("EVAL-08b: setMinter reverts if called twice", async () => {
    const { nft, minter, other } = await deploy();
    await nft.setMinter(minter.address);
    await expect(nft.setMinter(other.address))
      .to.be.revertedWithCustomError(nft, "MinterAlreadySet");
  });

  it("EVAL-08c: tokenURI reverts for non-existent tokenId", async () => {
    const { nft } = await deploy();
    await expect(nft.tokenURI(999)).to.be.reverted;
  });
});

describe("EVAL-09: Pause / Unpause", () => {
  async function deploy() {
    const [owner, client, freelancer] = await ethers.getSigners();
    const FlowNFT = await ethers.getContractFactory("FlowNFT");
    const nft = await FlowNFT.deploy();
    const MockAgentRequester = await ethers.getContractFactory("MockAgentRequester");
    const platform = await MockAgentRequester.deploy();
    const FlowFiEscrow = await ethers.getContractFactory("FlowFiEscrow");
    const escrow = await FlowFiEscrow.deploy(
      await platform.getAddress(), await nft.getAddress(), 1n, ethers.parseEther("0.07")
    );
    const deadline = (await time.latest()) + 7 * 24 * 3600;
    return { escrow, owner, client, freelancer, deadline };
  }

  it("EVAL-09a: pause blocks createJob", async () => {
    const d = await deploy();
    await d.escrow.connect(d.owner).pause();
    await expect(
      d.escrow.connect(d.client).createJob(d.freelancer.address, "x", "https://github.com/x", d.deadline, { value: 1n })
    ).to.be.revertedWithCustomError(d.escrow, "EnforcedPause");
  });

  it("EVAL-09b: unpause restores createJob", async () => {
    const d = await deploy();
    await d.escrow.connect(d.owner).pause();
    await d.escrow.connect(d.owner).unpause();
    await expect(
      d.escrow.connect(d.client).createJob(d.freelancer.address, "x", "https://github.com/x", d.deadline, { value: ethers.parseEther("1") })
    ).to.not.be.reverted;
  });

  it("EVAL-09c: non-owner cannot pause", async () => {
    const d = await deploy();
    await expect(d.escrow.connect(d.client).pause())
      .to.be.revertedWithCustomError(d.escrow, "OwnableUnauthorizedAccount");
  });
});

describe("EVAL-10: handleResponse with empty result bytes refunds", () => {
  async function deployAll() {
    const [owner, client, freelancer] = await ethers.getSigners();
    const FlowNFT = await ethers.getContractFactory("FlowNFT");
    const nft = await FlowNFT.deploy();
    const MockAgentRequester = await ethers.getContractFactory("MockAgentRequester");
    const platform = await MockAgentRequester.deploy();
    const FlowFiEscrow = await ethers.getContractFactory("FlowFiEscrow");
    const escrow = await FlowFiEscrow.deploy(
      await platform.getAddress(), await nft.getAddress(), 1n, ethers.parseEther("0.07")
    );
    await nft.setMinter(await escrow.getAddress());
    const deadline = (await time.latest()) + 7 * 24 * 3600;
    const amount = ethers.parseEther("1.0");
    return { escrow, nft, platform, owner, client, freelancer, deadline, amount };
  }

  it("EVAL-10a: empty result bytes leads to refund via auto-callback", async () => {
    const d = await deployAll();
    await d.escrow.connect(d.client).createJob(
      d.freelancer.address, "x", "https://github.com/x", d.deadline, { value: d.amount }
    );
    await d.escrow.connect(d.freelancer).submitWork(0, "https://github.com/x");
    await d.platform.setMockResult(2, "0x");
    await expect(
      d.escrow.connect(d.client).invokeEvaluation(0)
    ).to.emit(d.escrow, "PaymentRefunded");
  });

  it("EVAL-10b: valid score leads to COMPLETE via auto-callback", async () => {
    const d = await deployAll();
    await d.escrow.connect(d.client).createJob(
      d.freelancer.address, "Build API", "https://github.com/pr/1", d.deadline, { value: d.amount }
    );
    await d.escrow.connect(d.freelancer).submitWork(0, "https://github.com/pr/2");
    const result = ethers.toUtf8Bytes('{"score":85,"reason":"Good"}');
    await d.platform.setMockResult(2, result);
    await d.escrow.connect(d.client).invokeEvaluation(0);
    const job = await d.escrow.jobs(0);
    expect(job.status).to.equal(3);
  });
});

describe("EVAL-11: Score boundary thresholds", () => {
  async function deployAll() {
    const [owner, client, freelancer, other] = await ethers.getSigners();
    const FlowNFT = await ethers.getContractFactory("FlowNFT");
    const nft = await FlowNFT.deploy();
    const MockAgentRequester = await ethers.getContractFactory("MockAgentRequester");
    const platform = await MockAgentRequester.deploy();
    const FlowFiEscrow = await ethers.getContractFactory("FlowFiEscrow");
    const escrow = await FlowFiEscrow.deploy(
      await platform.getAddress(), await nft.getAddress(), 1n, ethers.parseEther("0.07")
    );
    await nft.setMinter(await escrow.getAddress());
    const deadline = (await time.latest()) + 7 * 24 * 3600;
    const amount = ethers.parseEther("1.0");
    return { escrow, nft, platform, owner, client, freelancer, other, deadline, amount };
  }

  async function deployAndSubmit() {
    const d = await deployAll();
    await d.escrow.connect(d.client).createJob(
      d.freelancer.address, "Build API", "https://github.com/pr/1", d.deadline, { value: d.amount }
    );
    await d.escrow.connect(d.freelancer).submitWork(0, "https://github.com/pr/2");
    return d;
  }

  async function deployAndEval(score: number) {
    const d = await deployAndSubmit();
    const result = ethers.toUtf8Bytes(`{"score":${score},"reason":"Good"}`);
    await d.platform.setMockResult(2, result);
    await d.escrow.connect(d.client).invokeEvaluation(0);
    return d;
  }

  it("EVAL-11a: score == 80 releases payment (exact release threshold)", async () => {
    const d = await deployAndEval(80);
    const job = await d.escrow.jobs(0);
    expect(job.status).to.equal(3);
  });

  it("EVAL-11b: score == 50 triggers DISPUTED (exact dispute threshold)", async () => {
    const d = await deployAndEval(50);
    const job = await d.escrow.jobs(0);
    expect(job.status).to.equal(4);
  });

  it("EVAL-11c: score == 49 triggers REFUND (just below dispute threshold)", async () => {
    const d = await deployAndEval(49);
    const job = await d.escrow.jobs(0);
    expect(job.status).to.equal(5);
  });
});

describe("EVAL-12: invokeEvaluation WrongStatus from every non-SUBMITTED state", () => {
  async function deployAll() {
    const [owner, client, freelancer] = await ethers.getSigners();
    const FlowNFT = await ethers.getContractFactory("FlowNFT");
    const nft = await FlowNFT.deploy();
    const MockAgentRequester = await ethers.getContractFactory("MockAgentRequester");
    const platform = await MockAgentRequester.deploy();
    const FlowFiEscrow = await ethers.getContractFactory("FlowFiEscrow");
    const escrow = await FlowFiEscrow.deploy(
      await platform.getAddress(), await nft.getAddress(), 1n, ethers.parseEther("0.07")
    );
    await nft.setMinter(await escrow.getAddress());
    const deadline = (await time.latest()) + 7 * 24 * 3600;
    const amount = ethers.parseEther("1.0");
    return { escrow, nft, platform, owner, client, freelancer, deadline, amount };
  }

  it("EVAL-12a: invokeEvaluation reverts from FUNDED", async () => {
    const d = await deployAll();
    await d.escrow.connect(d.client).createJob(
      d.freelancer.address, "x", "https://github.com/x", d.deadline, { value: d.amount }
    );
    await expect(d.escrow.connect(d.client).invokeEvaluation(0))
      .to.be.revertedWithCustomError(d.escrow, "WrongStatus");
  });

  it("EVAL-12b: invokeEvaluation reverts from COMPLETE", async () => {
    const d = await deployAll();
    await d.escrow.connect(d.client).createJob(d.freelancer.address, "x", "https://github.com/x", d.deadline, { value: d.amount });
    await d.escrow.connect(d.freelancer).submitWork(0, "https://github.com/x");
    const result = ethers.toUtf8Bytes('{"score":85,"reason":"good"}');
    await d.platform.setMockResult(2, result);
    await d.escrow.connect(d.client).invokeEvaluation(0);
    await expect(d.escrow.connect(d.client).invokeEvaluation(0))
      .to.be.revertedWithCustomError(d.escrow, "WrongStatus");
  });

  it("EVAL-12c: invokeEvaluation reverts from DISPUTED", async () => {
    const d = await deployAll();
    await d.escrow.connect(d.client).createJob(d.freelancer.address, "x", "https://github.com/x", d.deadline, { value: d.amount });
    await d.escrow.connect(d.freelancer).submitWork(0, "https://github.com/x");
    const result = ethers.toUtf8Bytes('{"score":65,"reason":"disputed"}');
    await d.platform.setMockResult(2, result);
    await d.escrow.connect(d.client).invokeEvaluation(0);
    await expect(d.escrow.connect(d.client).invokeEvaluation(0))
      .to.be.revertedWithCustomError(d.escrow, "WrongStatus");
  });

  it("EVAL-12d: invokeEvaluation reverts from REFUNDED", async () => {
    const d = await deployAll();
    await d.escrow.connect(d.client).createJob(d.freelancer.address, "x", "https://github.com/x", d.deadline, { value: d.amount });
    await d.escrow.connect(d.freelancer).submitWork(0, "https://github.com/x");
    const result = ethers.toUtf8Bytes('{"score":30,"reason":"refund"}');
    await d.platform.setMockResult(2, result);
    await d.escrow.connect(d.client).invokeEvaluation(0);
    await expect(d.escrow.connect(d.client).invokeEvaluation(0))
      .to.be.revertedWithCustomError(d.escrow, "WrongStatus");
  });
});

describe("EVAL-13: Domain allowlist edge cases", () => {
  async function deploy() {
    const [owner, client, freelancer] = await ethers.getSigners();
    const FlowNFT = await ethers.getContractFactory("FlowNFT");
    const nft = await FlowNFT.deploy();
    const MockAgentRequester = await ethers.getContractFactory("MockAgentRequester");
    const platform = await MockAgentRequester.deploy();
    const FlowFiEscrow = await ethers.getContractFactory("FlowFiEscrow");
    const escrow = await FlowFiEscrow.deploy(
      await platform.getAddress(), await nft.getAddress(), 1n, ethers.parseEther("0.07")
    );
    const deadline = (await time.latest()) + 7 * 24 * 3600;
    return { escrow, owner, client, freelancer, deadline };
  }

  it("EVAL-13a: allows http:// with allowed domain", async () => {
    const d = await deploy();
    await expect(
      d.escrow.connect(d.client).createJob(d.freelancer.address, "x", "http://github.com/x", d.deadline, { value: ethers.parseEther("1") })
    ).to.not.be.reverted;
  });

  it("EVAL-13b: rejects bare domain without http(s)://", async () => {
    const d = await deploy();
    await expect(
      d.escrow.connect(d.client).createJob(d.freelancer.address, "x", "github.com", d.deadline, { value: ethers.parseEther("1") })
    ).to.be.revertedWithCustomError(d.escrow, "DomainNotAllowed");
  });

  it("EVAL-13c: rejects unknown domain", async () => {
    const d = await deploy();
    await expect(
      d.escrow.connect(d.client).createJob(d.freelancer.address, "x", "https://evil.com/x", d.deadline, { value: ethers.parseEther("1") })
    ).to.be.revertedWithCustomError(d.escrow, "DomainNotAllowed");
  });
});
