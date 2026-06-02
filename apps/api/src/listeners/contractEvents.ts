import { createPublicClient, http } from "viem";
import { somniaTestnet } from "../lib/chains";
import { prisma } from "../lib/prisma";
import { ESCROW_ADDRESS, DEPLOY_BLOCK } from "../lib/config";
import escrowAbi from "@payfi/types/abis/FlowFiEscrow.json";

const httpClient = createPublicClient({
  chain: somniaTestnet,
  transport: http(process.env.SOMNIA_RPC_URL!, { timeout: 20_000 })
});

const EVENTS = ["EvaluationComplete", "PaymentReleased", "PaymentRefunded", "PaymentDisputed"] as const;

const BATCH_SIZE = 5000n;
const POLL_INTERVAL_MS = 12_000;

let lastPolledBlock = 0n;

async function processEvents(fromBlock: bigint): Promise<bigint> {
  const latestBlock = await httpClient.getBlockNumber();
  let maxProcessed = fromBlock;

  for (let b = fromBlock; b < latestBlock; b += BATCH_SIZE) {
    const toBlock = b + BATCH_SIZE - 1n > latestBlock ? latestBlock : b + BATCH_SIZE - 1n;
    for (const eventName of EVENTS) {
      try {
        const logs = await httpClient.getContractEvents({
          address: ESCROW_ADDRESS(),
          abi: escrowAbi,
          eventName,
          fromBlock: b,
          toBlock
        });
        for (const log of logs) {
          try {
            await handleEvent(eventName, log);
          } catch (e: any) {
            console.error(`Error processing ${eventName} event: ${e.message}`);
          }
        }
      } catch (e: any) {
        console.error(`Poll failed for ${eventName} blocks [${b}-${toBlock}]: ${e.message}`);
      }
    }
    maxProcessed = toBlock;
  }
  return maxProcessed + 1n;
}

async function handleEvent(eventName: string, log: any): Promise<void> {
  const args = log.args;
  switch (eventName) {
    case "EvaluationComplete": {
      await prisma.evaluation.upsert({
        where: { requestId: log.transactionHash },
        create: {
          jobId: args.jobId!.toString(),
          score: Number(args.score),
          reason: args.reason!,
          status: "COMPLETE",
          completedAt: new Date()
        },
        update: {
          score: Number(args.score),
          reason: args.reason!,
          status: "COMPLETE",
          completedAt: new Date()
        }
      });
      break;
    }
    case "PaymentReleased":
      await prisma.job.updateMany({
        where: { jobId: BigInt(args.jobId) },
        data: { status: "COMPLETE" }
      });
      break;
    case "PaymentRefunded":
      await prisma.job.updateMany({
        where: { jobId: BigInt(args.jobId) },
        data: { status: "REFUNDED" }
      });
      break;
    case "PaymentDisputed":
      await prisma.job.updateMany({
        where: { jobId: BigInt(args.jobId) },
        data: { status: "DISPUTED" }
      });
      break;
  }
}

export async function startEventListener() {
  const startBlock = DEPLOY_BLOCK();
  console.log(`Starting event poller from block ${startBlock}`);

  lastPolledBlock = await processEvents(startBlock);
  console.log(`Initial re-index complete at block ${lastPolledBlock - 1n}`);

  setInterval(async () => {
    try {
      lastPolledBlock = await processEvents(lastPolledBlock);
    } catch (e: any) {
      console.error(`Poll cycle failed: ${e.message}`);
    }
  }, POLL_INTERVAL_MS);
}
