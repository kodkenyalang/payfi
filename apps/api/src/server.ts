import * as dotenv from "dotenv";
dotenv.config();

import { validateEnv } from "./env";
validateEnv();

import express from "express";
import cors from "cors";
import "express-async-errors";
import jobRoutes from "./routes/jobs";
import { startEventListener } from "./listeners/contractEvents";
import { evaluationWorker } from "./workers/evaluationWorker";
import { prisma } from "./lib/prisma";

const DEADLINE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use("/api", jobRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("Unhandled error:", err);
  res.status(503).json({ error: "SERVICE_UNAVAILABLE", message: err.message });
});

async function checkDeadlines(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const atRisk = await prisma.job.findMany({
      where: {
        deadlineAt: { lt: cutoff },
        status: { in: ["FUNDED", "SUBMITTED"] }
      }
    });
    if (atRisk.length > 0) {
      console.warn(`[deadline-checker] ${atRisk.length} job(s) approaching deadline:`);
      for (const j of atRisk) {
        console.warn(`  jobId=${j.jobId} deadline=${j.deadlineAt.toISOString()} status=${j.status}`);
      }
    }
  } catch (e: any) {
    console.error(`[deadline-checker] check failed: ${e.message}`);
  }
}

app.listen(PORT, () => {
  console.log(`PayFi API running on port ${PORT}`);

  startEventListener().catch((e) => {
    console.error("Event listener failed to start:", e.message);
    console.log("API continues in degraded mode — event polling offline");
  });

  setInterval(checkDeadlines, DEADLINE_CHECK_INTERVAL_MS);
  checkDeadlines(); // run once immediately on startup
  console.log("Deadline checker armed (every 6 hours)");
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down...");
  try { if (evaluationWorker) await evaluationWorker.close(); } catch {}
  process.exit(0);
});

export default app;
