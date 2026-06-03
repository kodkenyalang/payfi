import { Worker, Queue } from "bullmq";
import { prisma } from "../lib/prisma";
import { REDIS_URL } from "../lib/config";

const redisUrl = REDIS_URL();

let evaluationQueue: Queue | null = null;
let evaluationWorker: Worker | null = null;

function isPlaceholder(url: string): boolean {
  return url.includes("some-redis-instance") || url.includes("localhost") || url.includes("127.0.0.1");
}

function redisConnection(url: string) {
  const isUpstash = url.includes("upstash.io");
  return { url, maxRetriesPerRequest: null, ...(isUpstash ? { tls: {} } : {}) };
}

if (!isPlaceholder(redisUrl) && redisUrl.startsWith("redis://")) {
  try {
    evaluationQueue = new Queue("evaluation", {
      connection: redisConnection(redisUrl),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 }
      }
    });

    evaluationWorker = new Worker(
      "evaluation",
      async (job) => {
        const { jobId, deliverableUrl } = job.data as { jobId: string; deliverableUrl: string };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          const resp = await fetch(deliverableUrl, { method: "HEAD", signal: controller.signal });
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
        connection: redisConnection(redisUrl),
        concurrency: 5
      }
    );

    evaluationWorker.on("failed", (job, err) => {
      console.error(`Worker job ${job?.id} failed after retries:`, err.message);
    });

    console.log("BullMQ worker initialized with Redis");
  } catch (e: any) {
    console.warn("BullMQ/Redis unavailable:", e.message);
  }
} else {
  console.log("BullMQ worker disabled — no Redis configured");
}

export { evaluationQueue, evaluationWorker };