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

app.listen(PORT, () => {
  console.log(`PayFi API running on port ${PORT}`);

  startEventListener().catch((e) => {
    console.error("Event listener failed to start:", e.message);
    console.log("API continues in degraded mode — event polling offline");
  });

  try {
    console.log("BullMQ worker initialized");
  } catch (e: any) {
    console.error("BullMQ worker init failed:", e.message);
    console.log("API continues in degraded mode — URL reachability checks disabled");
  }
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down...");
  try { await evaluationWorker.close(); } catch {}
  process.exit(0);
});

export default app;
