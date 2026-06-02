import { ethers } from "hardhat";

const REGISTRY = "0x08D1Fc808f1983d2Ea7B63a28ECD4d8C885Cd02A";
const PLATFORM = "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776";

async function main() {
  const provider = ethers.provider;

  // Try enumerating agents via the registry at indices 0, 1, 2
  // The agents() function might return the agent ID + metadata
  console.log("Enumerating AgentRegistry agents(0), agents(1), agents(2)...\n");

  // Try many different return type combinations
  const returnTypes = [
    "address,uint256,string,string",
    "uint256,string,string,address",
    "string,string,address,uint256",
    "uint256,address,string,string,bool",
    "string,string,uint256,address,bool",
    "address,string,string,uint256,bool",
    "uint256,string,string",
    "string,string,uint256",
  ];

  for (const retType of returnTypes) {
    try {
      const sig = `function agents(uint256) view returns (${retType})`;
      const name = "agents";
      const iface = new ethers.Interface([sig]);
      for (let idx = 0; idx < 3; idx++) {
        const data = iface.encodeFunctionData(name, [BigInt(idx)]);
        const result = await provider.call({ to: REGISTRY, data });
        const decoded = iface.decodeFunctionResult(name, result);
        console.log(`✔ agents(${idx}) returns (${retType}): ${JSON.stringify(decoded).substring(0, 200)}`);
      }
    } catch { /* skip */ }
  }

  // Try getting agent IDs from the registry
  const listVariants = [
    ["getAgentIds()", "uint256[]"],
    ["agentIds()", "uint256[]"],
    ["getAllAgentIds()", "uint256[]"],
    ["listAgentIds()", "uint256[]"],
    ["getAgents()", "uint256[]"],
    ["getAllAgents()", "uint256[]"],
    ["getRegisteredAgents()", "uint256[]"],
  ];

  for (const [sig, ret] of listVariants) {
    try {
      const name = sig.split("(")[0];
      const iface = new ethers.Interface([`function ${sig} view returns (${ret})`]);
      const data = iface.encodeFunctionData(name);
      const result = await provider.call({ to: REGISTRY, data });
      const decoded = iface.decodeFunctionResult(name, result);
      console.log(`✔ ${sig}: ${JSON.stringify(decoded).substring(0, 200)}`);
    } catch { /* skip */ }
  }

  // Wider brute force around the known JSON API agent ID
  const knownId = BigInt("13174292974160097713");
  const createReqABI = ["function createRequest(uint256,address,bytes4,bytes) payable returns (uint256)"];
  const createReqIface = new ethers.Interface(createReqABI);

  console.log("\nSearching for LLM agents (checking 100 IDs above known)...");
  let found = 0;
  for (let offset = 1; offset <= 100; offset++) {
    const id = knownId + BigInt(offset);
    try {
      const data = createReqIface.encodeFunctionData("createRequest", [id, PLATFORM, "0x00000000", "0x"]);
      await provider.call({ to: PLATFORM, data, value: ethers.parseEther("0.12") });
      console.log(`  ✅ Agent ${id} (offset ${offset}): VALID`);
      found++;
      if (found >= 2) break; // Found both remaining agents
    } catch {
      // Expected for invalid IDs
    }
  }

  if (found < 2) {
    // Try below the known ID
    console.log("  (not found above, trying below...)");
    for (let offset = -1; offset >= -100; offset--) {
      const id = knownId + BigInt(offset);
      try {
        const data = createReqIface.encodeFunctionData("createRequest", [id, PLATFORM, "0x00000000", "0x"]);
        await provider.call({ to: PLATFORM, data, value: ethers.parseEther("0.12") });
        console.log(`  ✅ Agent ${id} (offset ${offset}): VALID`);
        found++;
        if (found >= 2) break;
      } catch { /* skip */ }
    }
  }

  if (found === 0) {
    console.log("\n  No other agent IDs found near the JSON API agent.");
    console.log("  Agent IDs might use a completely different numbering scheme.");
  }

  console.log("\nDone.");
}

main().catch(e => console.error(e));
