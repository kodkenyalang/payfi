import { artifacts, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const ABI_OUT_DIR = path.join(__dirname, "../../../packages/types/abis");

async function main() {
  await run("compile");

  const contractNames = [
    "FlowFiEscrow",
    "DeliverableOracle",
    "CompletionEvaluator",
    "FlowNFT"
  ];

  fs.mkdirSync(ABI_OUT_DIR, { recursive: true });

  for (const name of contractNames) {
    try {
      const artifact = await artifacts.readArtifact(name);
      const outPath = path.join(ABI_OUT_DIR, `${name}.json`);
      fs.writeFileSync(outPath, JSON.stringify(artifact.abi, null, 2));
      console.log(`✓ Exported ABI: ${name}`);
    } catch {
      console.log(`⚠ Skipped (not yet compiled): ${name}`);
    }
  }
}

main().catch((err) => {
  console.error("ABI export failed:", err.message);
  process.exit(1);
});
