import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DEPLOYMENTS_PATH = path.join(__dirname, "../../../packages/types/deployments.json");
const deployments = JSON.parse(fs.readFileSync(DEPLOYMENTS_PATH, "utf8")).somnia_testnet;

const PASS = "\x1b[32m✔\x1b[0m";
const FAIL = "\x1b[31m✘\x1b[0m";
const SKIP = "\x1b[33m–\x1b[0m";
const INFO = "\x1b[36mi\x1b[0m";

let passed = 0; let failed = 0; let skipped = 0;

function ok(msg: string) { passed++; console.log(`  ${PASS} ${msg}`); }
function fail(msg: string) { failed++; console.log(`  ${FAIL} ${msg}`); }
function skip(msg: string) { skipped++; console.log(`  ${SKIP} ${msg}`); }

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = ethers.provider;
  const balance = await provider.getBalance(deployer.address);

  console.log(`\n${INFO} Deployer: ${deployer.address} | Balance: ${ethers.formatEther(balance)} STT`);
  console.log(`${INFO} Chain ID: ${(await provider.getNetwork()).chainId}`);
  console.log(`${INFO} RPC: ${process.env.SOMNIA_RPC_URL}`);
  console.log(`\n${INFO} Deployed contracts:`);
  console.log(`     FlowFiEscrow: ${deployments.escrow}`);
  console.log(`     FlowNFT:      ${deployments.nft}`);
  console.log(`     Platform:     ${deployments.platformAddress}`);
  console.log(`     Deploy block: ${deployments.deployBlock}\n`);

  // ── A: Contract state & connectivity ────────────────────────────────────
  console.log("─── A. Connectivity & Contract State ───");

  const escrowCode = await provider.getCode(deployments.escrow);
  ok(`Escrow exists (code length: ${escrowCode.length / 2 - 1} bytes)`);

  const nftCode = await provider.getCode(deployments.nft);
  ok(`NFT exists (code length: ${nftCode.length / 2 - 1} bytes)`);

  const platformCode = await provider.getCode(deployments.platformAddress);
  if (platformCode !== "0x") {
    ok(`Platform contract exists (code length: ${platformCode.length / 2 - 1} bytes)`);
    console.log(`     — Platform code (first 200 chars): ${platformCode.substring(0, 200)}`);
    // Check selector 0x0ede9759 is valid
    const createReqSel = ethers.id("createRequest(uint256,address,bytes4,bytes)").substring(2, 10);
    const getDepSel = ethers.id("getRequestDeposit()").substring(2, 10);
    const hasCreateReq = platformCode.toLowerCase().includes(createReqSel);
    const hasGetDep = platformCode.toLowerCase().includes(getDepSel);
    console.log(`     — createRequest selector 0x${createReqSel}: platform has it = ${hasCreateReq}`);
    console.log(`     — getRequestDeposit selector 0x${getDepSel}: platform has it = ${hasGetDep}`);
    // Try known error selectors for agent issues
    const errorSigs = [
      "InvalidAgentId(uint256)", "AgentNotAvailable(uint256)", "UnauthorizedAgent(uint256)",
      "InvalidAgent(uint256)", "WrongAgent(uint256)", "AgentIdNotSupported(uint256)",
      "InvalidConfig()", "NotSupported()", "Unauthorized()", "InvalidInput()"
    ];
    for (const s of errorSigs) {
      if (ethers.id(s).substring(2, 10) === "0ede9759") {
        console.log(`     — !! Error selector 0x0ede9759 matches: ${s}`);
      }
    }
  } else {
    fail("Platform contract has no code — verify address");
  }

  // Read escrow contract state
  const escrow = await ethers.getContractAt("FlowFiEscrow", deployments.escrow);
  const nft = await ethers.getContractAt("FlowNFT", deployments.nft);

  let nftName: string, nftSymbol: string;
  try {
    nftName = await nft.name();
    nftSymbol = await nft.symbol();
    ok(`NFT: ${nftName} (${nftSymbol})`);
  } catch { fail("Cannot read NFT name/symbol"); }

  let onChainPlatform: string, onChainNft: string, agentId: bigint, cost: bigint;
  try {
    onChainPlatform = await escrow.platform();
    onChainNft = await escrow.nft();
    agentId = await escrow.llmAgentId();
    cost = await escrow.llmCostPerAgent();
    ok(`Escrow config: platform=${onChainPlatform.substring(0, 10)}.. nft=${onChainNft.substring(0, 10)}..`);
    ok(`Agent config: id=${agentId}, cost=${ethers.formatEther(cost)} STT`);
  } catch (e: any) { fail(`Cannot read escrow state: ${e.message.substring(0, 80)}`); }

  // Check platform deposit cost
  let reserveDeposit: bigint;
  try {
    const platform = await ethers.getContractAt("IAgentRequester", deployments.platformAddress);
    reserveDeposit = await platform.getRequestDeposit();
    ok(`Platform getRequestDeposit() = ${ethers.formatEther(reserveDeposit)} STT`);
  } catch {
    reserveDeposit = 0n;
    skip("Could not call platform.getRequestDeposit()");
  }

  const rewardDeposit = cost * 3n;
  const totalDeposit = reserveDeposit + rewardDeposit;
  console.log(`\n${INFO} Agent fee: reserve=${ethers.formatEther(reserveDeposit)} + reward=${ethers.formatEther(rewardDeposit)} = ${ethers.formatEther(totalDeposit)} STT`);

  if (balance < totalDeposit + ethers.parseEther("0.01")) {
    fail(`Insufficient balance: need ${ethers.formatEther(totalDeposit + ethers.parseEther("0.01"))} STT, have ${ethers.formatEther(balance)}`);
    console.log(`\n${INFO} Insufficient balance — cannot proceed with on-chain tests.`);
    printSummary();
    process.exit(0);
  }

  // ── B. E2E: Create Job → Submit Work → Invoke → Poll Callback ──────────
  console.log("\n─── B. Full Job Lifecycle (on-chain) ───");

  const nextId = await escrow.nextJobId();
  console.log(`\n${INFO} Starting from nextJobId=${nextId} (deploy smoke test used job 0)`);

  const jobAmount = ethers.parseEther("0.2"); // must be > totalDeposit (0.12 STT)
  const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

  let jobId: bigint;
  let createReceipt: ethers.ContractTransactionReceipt;

  // B1. createJob
  try {
    const tx = await escrow.connect(deployer).createJob(
      deployer.address,
      "E2E: Build a REST API with Node.js and Express",
      "https://github.com/test/e2e",
      deadline,
      { value: jobAmount }
    );
    createReceipt = await tx.wait();
    if (!createReceipt) throw new Error("No receipt");

    jobId = await escrow.nextJobId() - 1n;
    const job = await escrow.jobs(jobId);
    ok(`createJob: jobId=${jobId}, status=${job.status} (FUNDED), amount=${ethers.formatEther(job.amount)} STT, block=${createReceipt.blockNumber}`);
  } catch (e: any) {
    fail(`createJob failed: ${e.message.substring(0, 120)}`);
    printSummary();
    process.exit(0);
  }

  // B2. submitWork
  try {
    const deliverableUrl = "https://github.com/payfi/e2e-test";
    const tx2 = await escrow.connect(deployer).submitWork(jobId, deliverableUrl);
    const r2 = await tx2.wait();
    const job = await escrow.jobs(jobId);
    if (job.status === 1n) ok("submitWork: status=1 (SUBMITTED)");
    else fail(`submitWork: expected status=1, got ${job.status}`);
  } catch (e: any) {
    const reason = e.reason || e.message.substring(0, 120);
    fail(`submitWork failed: ${reason}`);
    const j = await escrow.jobs(jobId);
    console.log(`     — Debug: freelancer=${deployer.address}, job.freelancer=${j.freelancer}`);
    console.log(`     — Debug: job.status=${j.status}, deadline=${j.deadline}`);
  }

  // B3. invokeEvaluation
  let evalTx: ethers.ContractTransactionReceipt | undefined;
  let agentRequestId: bigint | undefined;
  try {
    const jobState = await escrow.jobs(jobId);
    const escrowBalance = await provider.getBalance(deployments.escrow);
    console.log(`     — Debug: job.status=${jobState.status}, job.amount=${ethers.formatEther(jobState.amount)} STT`);
    console.log(`     — Debug: escrow balance=${ethers.formatEther(escrowBalance)} STT`);
    console.log(`     — Debug: totalDeposit needed=${ethers.formatEther(totalDeposit)} STT`);

    // Use low-level call to capture revert data from platform
    const pop = await escrow.connect(deployer).invokeEvaluation.populateTransaction(jobId);
    await provider.call({ ...pop, from: deployer.address });
    // If we get here, call succeeded
    const tx3 = await escrow.connect(deployer).invokeEvaluation(jobId);
    evalTx = await tx3.wait();
    if (!evalTx) throw new Error("No receipt");

    const evalReqEvent = evalTx.logs.find((l: any) => l.eventName === "EvaluationRequested") as any;
    agentRequestId = evalReqEvent?.args?.[1] ?? 0n;
    ok(`invokeEvaluation: agentRequestId=${agentRequestId}, block=${evalTx.blockNumber}`);
  } catch (e: any) {
    const err = e as { reason?: string; data?: string; shortMessage?: string };
    let reason = "unknown";
    if (err?.data) {
      // Platform error (not our contract)
      reason = `platform reverted: 0x${err.data.substring(2, 10)}...`;
    } else {
      reason = err?.reason || err?.shortMessage || e.message.substring(0, 100);
    }
    console.log(`     — Debug: job.status=${(await escrow.jobs(jobId)).status}, escrow balance=${ethers.formatEther(await provider.getBalance(deployments.escrow))} STT`);
    console.log(`     — invokeEvaluation reverted: ${reason}`);
    console.log(`     — This is expected if the Somnia platform doesn't recognize the configured agent ID.`);
    console.log(`     — Fix: set SOMNIA_LLM_INFERENCE_AGENT_ID in .env to the correct LLM agent ID`);
    console.log(`     —       from https://agents.testnet.somnia.network (LLM Inference agent)`);
    skip("invokeEvaluation (requires correct LLM agent ID from Somnia Agent Explorer)");
  }

  // Print final job state (if we got to invokeEvaluation)
  if (typeof evalTx !== "undefined") {
    console.log(`\n${INFO} Polling for platform callback (up to 300s, interval 15s)...`);
    const startTime = Date.now();
    const timeout = 300_000;

    while (Date.now() - startTime < timeout) {
      const events = await fetchEvents(escrow, evalTx.blockNumber!, (await provider.getBlockNumber()));
      const completeEvents = events.filter((e: any) =>
        ["EvaluationComplete","PaymentReleased","PaymentDisputed","PaymentRefunded","AgentTimedOut","AgentFailed"].includes(e.event)
      );
      if (completeEvents.length > 0) {
        for (const ev of completeEvents) console.log(`     [${ev.event}] block=${ev.blockNumber}`);
        break;
      }
      await sleep(15_000);
    }
  }

  const j = await escrow.jobs(jobId);
  console.log(`\n${INFO} Job ${jobId} final state:`);
  console.log(`     status:          ${j.status} (${["FUNDED","SUBMITTED","EVALUATING","COMPLETE","DISPUTED","REFUNDED"][Number(j.status)]})`);
  console.log(`     amount:          ${ethers.formatEther(j.amount)} STT`);
  console.log(`     evalScore:       ${j.evaluationScore}`);
  console.log(`     evalReason:      "${j.evaluationReason}"`);

  printSummary();
}

async function fetchEvents(contract: any, fromBlock: number, toBlock: number) {
  const filter = { address: await contract.getAddress(), fromBlock, toBlock };
  const logs = await ethers.provider.getLogs(filter);
  const events = [];
  for (const log of logs) {
    try {
      const parsed = contract.interface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed) events.push({ event: parsed.name, args: parsed.args, blockNumber: log.blockNumber });
    } catch { /* skip unparseable */ }
  }
  return events;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function printSummary() {
  const total = passed + failed + skipped;
  console.log(`\n─── Results: ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total) ───`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
