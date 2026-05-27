import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_PATH = path.join(
  __dirname,
  "../../../packages/types/deployments.json"
);

const SOMNIA_PARSE_AGENT    = process.env.SOMNIA_PARSE_AGENT_ADDRESS!;
const SOMNIA_INFERENCE_AGENT = process.env.SOMNIA_INFERENCE_AGENT_ADDRESS!;
const SOMNIA_CALLBACK_SENDER = process.env.SOMNIA_CALLBACK_SENDER_ADDRESS!;

async function main() {
  if (!SOMNIA_PARSE_AGENT || !SOMNIA_INFERENCE_AGENT || !SOMNIA_CALLBACK_SENDER) {
    throw new Error(
      "Somnia agent addresses not set. Add to .env:\n" +
      "  SOMNIA_PARSE_AGENT_ADDRESS\n" +
      "  SOMNIA_INFERENCE_AGENT_ADDRESS\n" +
      "  SOMNIA_CALLBACK_SENDER_ADDRESS"
    );
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const FlowNFT = await ethers.getContractFactory("FlowNFT");
  const nft = await FlowNFT.deploy();
  await nft.waitForDeployment();
  const nftAddress = await nft.getAddress();
  console.log("✓ FlowNFT:", nftAddress);

  const CompletionEvaluator = await ethers.getContractFactory("CompletionEvaluator");
  const evaluator = await CompletionEvaluator.deploy(
    SOMNIA_INFERENCE_AGENT,
    SOMNIA_CALLBACK_SENDER
  );
  await evaluator.waitForDeployment();
  const evaluatorAddress = await evaluator.getAddress();
  console.log("✓ CompletionEvaluator:", evaluatorAddress);

  const DeliverableOracle = await ethers.getContractFactory("DeliverableOracle");
  const oracle = await DeliverableOracle.deploy(
    SOMNIA_PARSE_AGENT,
    SOMNIA_CALLBACK_SENDER
  );
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log("✓ DeliverableOracle:", oracleAddress);

  const FlowFiEscrow = await ethers.getContractFactory("FlowFiEscrow");
  const escrow = await FlowFiEscrow.deploy();
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("✓ FlowFiEscrow:", escrowAddress);

  console.log("\nSetting cross-contract permissions...");

  await (await escrow.setOracle(oracleAddress)).wait();
  await (await escrow.setEvaluator(evaluatorAddress)).wait();
  await (await escrow.setNFT(nftAddress)).wait();
  console.log("✓ Escrow: oracle, evaluator, nft set");

  await (await oracle.setEscrow(escrowAddress)).wait();
  await (await oracle.setEvaluator(evaluatorAddress)).wait();
  console.log("✓ Oracle: escrow, evaluator set");

  await (await evaluator.setOracle(oracleAddress)).wait();
  await (await evaluator.setEscrow(escrowAddress)).wait();
  console.log("✓ Evaluator: oracle, escrow set");

  await (await nft.setMinter(escrowAddress)).wait();
  console.log("✓ NFT: minter set to escrow");

  console.log("\nRunning smoke test...");
  const testFreelancer = "0x000000000000000000000000000000000000dEaD";
  const deadline = Math.floor(Date.now() / 1000) + 86400;
  const tx = await escrow.createJob(
    testFreelancer,
    "Smoke test requirements",
    "https://github.com/test",
    deadline,
    { value: ethers.parseEther("0.001") }
  );
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Smoke test failed — no receipt");
  console.log("✓ Smoke test passed at block", receipt.blockNumber);

  const network = await ethers.provider.getNetwork();
  const deployments = {
    somnia_devnet: {
      chainId: network.chainId.toString(),
      escrow: escrowAddress,
      oracle: oracleAddress,
      evaluator: evaluatorAddress,
      nft: nftAddress,
      deployBlock: receipt.blockNumber,
      deployedAt: new Date().toISOString()
    }
  };

  fs.mkdirSync(path.dirname(DEPLOYMENTS_PATH), { recursive: true });
  fs.writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(deployments, null, 2));
  console.log("\n=== Stage 2 Deployment Complete ===");
  console.log(JSON.stringify(deployments.somnia_devnet, null, 2));
}

main().catch((err) => {
  console.error("Deployment failed:", err.message);
  process.exit(1);
});
