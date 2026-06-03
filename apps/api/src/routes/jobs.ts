import { Router, Request, Response } from "express";
import { createPublicClient, http, getEventSelector, decodeEventLog } from "viem";
import { somniaTestnet } from "../lib/chains";
import { prisma } from "../lib/prisma";
import { ESCROW_ADDRESS } from "../lib/config";
import { validateDeliverableUrl } from "../middleware/validateUrl";
import escrowAbi from "@payfi/types/abis/FlowFiEscrow.json";
import { evaluationQueue } from "../workers/evaluationWorker";
import { z } from "zod";

const publicClient = createPublicClient({
  chain: somniaTestnet,
  transport: http(process.env.SOMNIA_RPC_URL!)
});

const JOB_STATUS_MAP: Record<number, string> = {
  0: "FUNDED", 1: "SUBMITTED", 2: "EVALUATING",
  3: "COMPLETE", 4: "DISPUTED", 5: "REFUNDED"
};

const createJobSchema = z.object({
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  deliverableUrl: z.string(),
  requirements: z.string().min(1)
});

const submitWorkSchema = z.object({
  deliverableUrl: z.string()
});

const router = Router();

router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

router.post("/jobs", validateDeliverableUrl, async (req: Request, res: Response) => {
  try {
    const body = createJobSchema.parse(req.body);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: body.transactionHash as `0x${string}`,
      timeout: 30_000
    });

    if (receipt.status !== "success") {
      return res.status(400).json({ error: "TX_FAILED", message: "Transaction reverted on-chain" });
    }

    const eventTopic = getEventSelector("JobCreated(uint256,address,address,uint256,uint256)");
    const log = receipt.logs.find(l =>
      l.address.toLowerCase() === ESCROW_ADDRESS().toLowerCase() &&
      l.topics[0] === eventTopic
    );

    if (!log) {
      return res.status(400).json({ error: "EVENT_NOT_FOUND", message: "JobCreated event not in tx" });
    }

    const decoded = decodeEventLog({
      abi: escrowAbi,
      data: log.data,
      topics: log.topics,
      eventName: "JobCreated"
    });

    const args = decoded.args as unknown as { jobId: bigint; client: string; freelancer: string; amount: bigint; deadline: bigint };

    const job = await prisma.job.create({
      data: {
        jobId: BigInt(args.jobId),
        clientAddress: args.client,
        freelancerAddress: args.freelancer,
        amountWei: args.amount.toString(),
        deliverableUrl: body.deliverableUrl,
        requirements: body.requirements,
        deadlineAt: new Date(Number(args.deadline) * 1000),
        transactionHash: body.transactionHash,
        status: "FUNDED"
      }
    });

    res.status(201).json(job);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "VALIDATION_ERROR", details: err.errors });
    }
    console.error("POST /api/jobs error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
  }
});

router.get("/jobs/:jobId", async (req: Request, res: Response) => {
  try {
    const jobId = BigInt(req.params.jobId);

    const dbJob = await prisma.job.findUnique({
      where: { jobId },
      include: {
        evaluations: { orderBy: { triggeredAt: "desc" }, take: 1 }
      }
    });

    if (!dbJob) return res.status(404).json({ error: "NOT_FOUND" });

    let chainJob: any = null;
    try {
      chainJob = await publicClient.readContract({
        address: ESCROW_ADDRESS(),
        abi: escrowAbi,
        functionName: "jobs",
        args: [jobId]
      });
    } catch {
      // On-chain read failed — return DB state only
    }

    const merged: any = { ...dbJob, status: dbJob.status };
    if (chainJob) {
      const chainStatus = JOB_STATUS_MAP[Number(chainJob[6])] || dbJob.status;
      merged.status = chainStatus;
      merged.onChain = {
        amount: chainJob[2].toString(),
        status: chainStatus
      };
    }

    res.json(merged);
  } catch (err: any) {
    console.error("GET /api/jobs/:jobId error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
  }
});

router.post("/jobs/:jobId/submit", async (req: Request, res: Response) => {
  try {
    const body = submitWorkSchema.parse(req.body);
    const jobId = req.params.jobId;

    await prisma.job.update({
      where: { jobId: BigInt(jobId) },
      data: { status: "SUBMITTED", deliverableUrl: body.deliverableUrl }
    });

    if (evaluationQueue) {
      await evaluationQueue.add("check-reachability", { jobId, deliverableUrl: body.deliverableUrl });
    }

    res.json({ success: true, message: "Work submitted" });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "VALIDATION_ERROR", details: err.errors });
    }
    console.error("POST /api/jobs/:jobId/submit error:", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
  }
});

router.post("/cron/check-deadlines", async (req: Request, res: Response) => {
  const secret = req.headers["x-cron-secret"];
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const atRisk = await prisma.job.findMany({
    where: {
      deadlineAt: { lt: cutoff },
      status: { in: ["FUNDED", "SUBMITTED"] }
    }
  });

  res.json({
    processed: atRisk.length,
    jobs: atRisk.map(j => ({
      id: j.id,
      jobId: j.jobId.toString(),
      deadlineAt: j.deadlineAt
    }))
  });
});

export default router;
