import { ethers, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_PATH = path.join(__dirname, "../../../packages/types/deployments.json");

const PLATFORM_ADDRESS   = process.env.SOMNIA_PLATFORM_ADDRESS!;
const LLM_AGENT_ID       = process.env.SOMNIA_LLM_INFERENCE_AGENT_ID!;
const LLM_COST_PER_AGENT = process.env.SOMNIA_LLM_COST_PER_AGENT!;

async function main() {
  if (!PLATFORM_ADDRESS || !LLM_AGENT_ID || !LLM_COST_PER_AGENT) {
    throw new Error(
      "Missing env vars. Set:\n" +
      "  SOMNIA_PLATFORM_ADDRESS (from docs.somnia.network)\n" +
      "  SOMNIA_LLM_INFERENCE_AGENT_ID (from agents.somnia.network)\n" +
      "  SOMNIA_LLM_COST_PER_AGENT (in STT wei, e.g. 30000000000000000 for 0.03 STT)"
    );
  }

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address, "Balance:", ethers.formatEther(balance), "STT");
  if (balance < ethers.parseEther("0.5")) {
    throw new Error("Insufficient balance -- fund deployer with at least 0.5 STT");
  }

  const FlowNFT = await ethers.getContractFactory("FlowNFT");
  const nft = await FlowNFT.deploy();
  await nft.waitForDeployment();
  const nftAddr = await nft.getAddress();
  console.log("✓ FlowNFT:", nftAddr);

  const FlowFiEscrow = await ethers.getContractFactory("FlowFiEscrow");
  const escrow = await FlowFiEscrow.deploy(
    PLATFORM_ADDRESS,
    nftAddr,
    BigInt(LLM_AGENT_ID),
    BigInt(LLM_COST_PER_AGENT)
  );
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log("✓ FlowFiEscrow:", escrowAddr);

  await (await nft.setMinter(escrowAddr)).wait();
  console.log("✓ NFT minter set to escrow");

  console.log("\nVerifying contracts on Somnia explorer...");
  try {
    await run("verify:verify", { address: nftAddr, constructorArguments: [] });
    await run("verify:verify", {
      address: escrowAddr,
      constructorArguments: [PLATFORM_ADDRESS, nftAddr, BigInt(LLM_AGENT_ID), BigInt(LLM_COST_PER_AGENT)]
    });
    console.log("✓ Contracts verified");
  } catch (e: any) {
    console.log("⚠ Verification failed (non-critical):", e.message);
  }

  const deadline = Math.floor(Date.now() / 1000) + 86400;
  const tx = await escrow.createJob(
    "0x000000000000000000000000000000000000dEaD",
    "smoke test", "https://github.com/test", deadline,
    { value: ethers.parseEther("0.01") }
  );
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Smoke test failed");
  console.log("✓ Smoke test passed, block:", receipt.blockNumber);

  const network = await ethers.provider.getNetwork();
  const deployments = {
    somnia_testnet: {
      chainId: network.chainId.toString(),
      escrow: escrowAddr,
      nft: nftAddr,
      platformAddress: PLATFORM_ADDRESS,
      llmAgentId: LLM_AGENT_ID,
      deployBlock: receipt.blockNumber,
      deployedAt: new Date().toISOString()
    }
  };
  fs.mkdirSync(path.dirname(DEPLOYMENTS_PATH), { recursive: true });
  fs.writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(deployments, null, 2));
  console.log("\n=== Deploy Complete ===");
  console.log(JSON.stringify(deployments.somnia_testnet, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
