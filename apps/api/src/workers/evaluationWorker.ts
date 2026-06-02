import { Worker, Queue } from "bullmq";
import { prisma } from "../lib/prisma";
import { REDIS_URL } from "../lib/config";

const redisUrl = REDIS_URL();

export const evaluationQueue = new Queue("evaluation", {
  connection: { url: redisUrl },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 }
  }
});

export const evaluationWorker = new Worker(
  "evaluation",
  async (job) => {
    const { jobId, deliverableUrl } = job.data as { jobId: string; deliverableUrl: string };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const resp = await fetch(deliverableUrl, {
        method: "HEAD",
        signal: controller.signal
      });
      clearTimeout(timeout);
      await prisma.job.update({
        where: { id: jobId },
        data: { deliverableReachable: resp.ok }
      });
      return { reachable: resp.ok, status: resp.status };
    } catch (err: any) {
      clearTimeout(timeout);
      console.error(`Reachability check failed for job ${jobId}:`, err.message);
      return { reachable: false, error: err.message };
    }
  },
  {
    connection: { url: redisUrl },
    concurrency: 5
  }
);

evaluationWorker.on("failed", (job, err) => {
  console.error(`Worker job ${job?.id} failed after retries:`, err.message);
});
