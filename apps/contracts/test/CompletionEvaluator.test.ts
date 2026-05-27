import { expect } from "chai";
import { ethers } from "hardhat";

describe("CompletionEvaluator", () => {
  async function deploy() {
    const [owner, oracleSigner, somniaAgent, other] = await ethers.getSigners();

    const MockEscrow = await ethers.getContractFactory("MockEscrow");
    const mockEscrow = await MockEscrow.deploy();

    const MockLLMInference = await ethers.getContractFactory("MockLLMInference");
    const mockAgent = await MockLLMInference.deploy();

    const Evaluator = await ethers.getContractFactory("CompletionEvaluator");
    const evaluator = await Evaluator.deploy(
      await mockAgent.getAddress(),
      somniaAgent.address
    );

    await evaluator.setOracle(oracleSigner.address);
    await evaluator.setEscrow(await mockEscrow.getAddress());

    return { evaluator, mockEscrow, oracleSigner, somniaAgent, other };
  }

  describe("requestScore", () => {
    it("requests score and emits ScoreRequested", async () => {
      const { evaluator, oracleSigner } = await deploy();
      const parseRequestId = ethers.id("test-parse-1");
      const tx = await evaluator.connect(oracleSigner).requestScore(
        parseRequestId, "deliverable content", "requirements", 1n
      );
      await expect(tx).to.emit(evaluator, "ScoreRequested");
    });

    it("reverts if called by non-oracle", async () => {
      const { evaluator, other } = await deploy();
      await expect(
        evaluator.connect(other).requestScore(ethers.id("x"), "c", "r", 1n)
      ).to.be.revertedWithCustomError(evaluator, "OnlyOracle");
    });
  });

  describe("fulfillScore", () => {
    it("parses valid JSON and calls fulfillEvaluation with correct score", async () => {
      const { evaluator, mockEscrow, oracleSigner, somniaAgent } = await deploy();
      const parseRequestId = ethers.id("test-1");
      await evaluator.connect(oracleSigner).requestScore(
        parseRequestId, "content", "requirements", 1n
      );
      await evaluator.connect(somniaAgent).fulfillScore(
        parseRequestId,
        '{"score": 85, "reason": "Good work"}'
      );
      const [score] = await mockEscrow.lastFulfillment();
      expect(score).to.equal(85n);
    });

    it("returns score=0 and reason=parse_error on malformed JSON", async () => {
      const { evaluator, mockEscrow, oracleSigner, somniaAgent } = await deploy();
      const requestId = ethers.id("test-2");
      await evaluator.connect(oracleSigner).requestScore(
        requestId, "content", "requirements", 2n
      );
      await evaluator.connect(somniaAgent).fulfillScore(requestId, "not json at all");
      const [score, , reason] = await mockEscrow.lastFulfillment();
      expect(score).to.equal(0n);
      expect(reason).to.equal("parse_error");
    });

    it("clamps score > 100 to 100", async () => {
      const { evaluator, mockEscrow, oracleSigner, somniaAgent } = await deploy();
      const requestId = ethers.id("test-3");
      await evaluator.connect(oracleSigner).requestScore(
        requestId, "content", "requirements", 3n
      );
      await evaluator.connect(somniaAgent).fulfillScore(
        requestId,
        '{"score": 999, "reason": "Clamped"}'
      );
      const [score] = await mockEscrow.lastFulfillment();
      expect(score).to.equal(100n);
    });

    it("does NOT revert on completely empty response", async () => {
      const { evaluator, oracleSigner, somniaAgent } = await deploy();
      const requestId = ethers.id("test-4");
      await evaluator.connect(oracleSigner).requestScore(
        requestId, "content", "requirements", 4n
      );
      await expect(
        evaluator.connect(somniaAgent).fulfillScore(requestId, "")
      ).to.not.be.reverted;
    });

    it("reverts if called by non-Somnia agent", async () => {
      const { evaluator, oracleSigner, other } = await deploy();
      const requestId = ethers.id("test-5");
      await evaluator.connect(oracleSigner).requestScore(
        requestId, "content", "requirements", 5n
      );
      await expect(
        evaluator.connect(other).fulfillScore(requestId, '{"score": 90, "reason": "ok"}')
      ).to.be.revertedWithCustomError(evaluator, "OnlySomniaAgent");
    });
  });
});
