"use client";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { injected } from "wagmi/connectors";
import escrowAbi from "@payfi/types/abis/FlowFiEscrow.json";
import { ESCROW_ADDRESS, API_URL } from "../lib/config";
import { useState, useEffect, useCallback } from "react";
import { useJobEvents } from "../hooks/useJobEvents";

type JobStatus = "FUNDED" | "SUBMITTED" | "EVALUATING" | "COMPLETE" | "DISPUTED" | "REFUNDED";

interface JobInfo {
  id: string;
  jobId: string;
  status: JobStatus;
  clientAddress: string;
  freelancerAddress: string;
  amountWei: string;
  requirements: string;
  deliverableUrl: string;
}

const STATUS_COLORS: Record<JobStatus, string> = {
  FUNDED: "#6366f1",
  SUBMITTED: "#f59e0b",
  EVALUATING: "#8b5cf6",
  COMPLETE: "#22c55e",
  DISPUTED: "#ef4444",
  REFUNDED: "#6b7280"
};

function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", background: "#1e293b", borderRadius: 8 }}>
        <span style={{ color: "#94a3b8" }}>{address?.slice(0, 6)}...{address?.slice(-4)}</span>
        <button onClick={() => disconnect()} style={{ background: "transparent", border: "1px solid #475569", color: "#cbd5e1", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button onClick={() => connect({ connector: injected() })} style={{ background: "#3b82f6", border: "none", color: "#fff", borderRadius: 8, padding: "10px 24px", cursor: "pointer", fontWeight: 600 }}>
      Connect Wallet
    </button>
  );
}

function EventLog({ events }: { events: string[] }) {
  if (events.length === 0) return null;
  return (
    <div style={{ marginTop: 16, padding: 12, background: "#0f172a", borderRadius: 8, border: "1px solid #1e293b" }}>
      <h4 style={{ margin: "0 0 8px", color: "#94a3b8", fontSize: 13 }}>Live Events</h4>
      {events.map((e, i) => (
        <div key={i} style={{ color: "#22d3ee", fontSize: 13, fontFamily: "monospace", padding: "2px 0" }}>◈ {e}</div>
      ))}
    </div>
  );
}

function JobStatusCard({ jobId, job, events, onLogEvent }: { jobId: bigint; job: JobInfo | null; events: string[]; onLogEvent: (msg: string) => void }) {
  const [fetchedJob, setFetchedJob] = useState<JobInfo | null>(job);

  useJobEvents({
    jobId,
    onEvaluationComplete: (score, reason) => {
      onLogEvent(`EvaluationComplete: score=${score} "${reason.slice(0, 40)}..."`);
      refreshJob();
    },
    onPaymentReleased: (tokenId) => {
      onLogEvent(`PaymentReleased: NFT #${tokenId} minted`);
      refreshJob();
    },
    onPaymentDisputed: (score) => {
      onLogEvent(`PaymentDisputed: score=${score}`);
      refreshJob();
    },
    onPaymentRefunded: () => {
      onLogEvent("PaymentRefunded");
      refreshJob();
    }
  });

  const refreshJob = useCallback(async () => {
    try {
      const resp = await fetch(`${API_URL}/api/jobs/${jobId.toString()}`, { cache: "no-store" });
      if (resp.ok) {
        const data = await resp.json();
        setFetchedJob(data);
      }
    } catch {}
  }, [jobId]);

  useEffect(() => { refreshJob(); const id = setInterval(refreshJob, 5000); return () => clearInterval(id); }, [refreshJob]);

  const display = fetchedJob || job;
  if (!display) return null;

  return (
    <div style={{ marginTop: 16, padding: 16, background: "#1e293b", borderRadius: 8, border: "1px solid #334155" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0, color: "#f1f5f9" }}>Job #{display.jobId}</h3>
        <span style={{ padding: "4px 12px", borderRadius: 12, fontSize: 12, fontWeight: 600, background: STATUS_COLORS[display.status] + "22", color: STATUS_COLORS[display.status], border: `1px solid ${STATUS_COLORS[display.status]}` }}>
          {display.status}
        </span>
      </div>
      <div style={{ fontSize: 13, color: "#94a3b8", display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px" }}>
        <span>Freelancer:</span><span style={{ color: "#cbd5e1", fontFamily: "monospace" }}>{display.freelancerAddress}</span>
        <span>Amount:</span><span style={{ color: "#cbd5e1" }}>{(BigInt(display.amountWei) / BigInt("10000000000000000")).toString()} STT</span>
        <span>Requirements:</span><span style={{ color: "#cbd5e1" }}>{display.requirements}</span>
        <span>Deliverable:</span><span style={{ color: "#cbd5e1", fontFamily: "monospace", fontSize: 12 }}>{display.deliverableUrl}</span>
      </div>
      <EventLog events={events} />
    </div>
  );
}

function CreateJobForm() {
  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const [freelancer, setFreelancer] = useState("");
  const [requirements, setRequirements] = useState("");
  const [deliverableUrl, setDeliverableUrl] = useState("https://github.com/");
  const [deadline, setDeadline] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 16);
  });
  const [amount, setAmount] = useState("0.5");
  const [createdJob, setCreatedJob] = useState<JobInfo | null>(null);
  const [apiError, setApiError] = useState("");
  const [events, setEvents] = useState<string[]>([]);

  const logEvent = useCallback((msg: string) => {
    setEvents(prev => [...prev, msg]);
  }, []);

  useEffect(() => {
    if (!isSuccess || !txHash) return;

    setApiError("");

    fetch(`${API_URL}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactionHash: txHash,
        deliverableUrl,
        requirements
      })
    })
      .then(async (resp) => {
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error((err as any).message || `API error ${resp.status}`);
        }
        return resp.json();
      })
      .then((job: JobInfo) => {
        setCreatedJob(job);
        logEvent(`Job #${job.jobId} created on-chain and persisted in API`);
      })
      .catch((err) => {
        setApiError(err.message);
      });
  }, [isSuccess, txHash, deliverableUrl, requirements, logEvent]);

  const label = isPending ? "Confirm in wallet..." :
    isConfirming ? "Submitting to chain..." :
    isSuccess ? "Job Created!" :
    "Create Job";

  const handleCreate = () => {
    setCreatedJob(null);
    setApiError("");
    setEvents([]);
    const deadlineTs = BigInt(Math.floor(new Date(deadline).getTime() / 1000));
    writeContract({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "createJob",
      args: [freelancer as `0x${string}`, requirements, deliverableUrl, deadlineTs],
      value: BigInt(Math.floor(parseFloat(amount) * 1e18))
    });
  };

  return (
    <div>
      <div style={{ border: "1px solid #334155", padding: 20, margin: "16px 0", borderRadius: 8, background: "#1e293b" }}>
        <h2 style={{ margin: "0 0 16px", color: "#f1f5f9" }}>Create Job</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input placeholder="Freelancer address (0x...)" value={freelancer} onChange={e => setFreelancer(e.target.value)}
            style={{ padding: 10, borderRadius: 6, border: "1px solid #475569", background: "#0f172a", color: "#e2e8f0", fontFamily: "monospace" }} />
          <input placeholder="Requirements (what needs to be built)" value={requirements} onChange={e => setRequirements(e.target.value)}
            style={{ padding: 10, borderRadius: 6, border: "1px solid #475569", background: "#0f172a", color: "#e2e8f0" }} />
          <input placeholder="Deliverable URL" value={deliverableUrl} onChange={e => setDeliverableUrl(e.target.value)}
            style={{ padding: 10, borderRadius: 6, border: "1px solid #475569", background: "#0f172a", color: "#e2e8f0", fontFamily: "monospace" }} />
          <div style={{ display: "flex", gap: 10 }}>
            <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)}
              style={{ flex: 1, padding: 10, borderRadius: 6, border: "1px solid #475569", background: "#0f172a", color: "#e2e8f0" }} />
            <input placeholder="Amount (STT)" value={amount} onChange={e => setAmount(e.target.value)}
              style={{ width: 120, padding: 10, borderRadius: 6, border: "1px solid #475569", background: "#0f172a", color: "#e2e8f0" }} />
          </div>
          <button onClick={handleCreate} disabled={isPending || isConfirming || isSuccess}
            style={{ padding: "12px 24px", borderRadius: 8, border: "none", cursor: isPending || isConfirming ? "wait" : "pointer", fontWeight: 600, background: isSuccess ? "#22c55e" : "#3b82f6", color: "#fff", opacity: isPending || isConfirming ? 0.7 : 1 }}>
            {label}
          </button>
        </div>
        {writeError && <p style={{ color: "#ef4444", fontSize: 13, margin: "8px 0 0" }}>{writeError.message}</p>}
        {apiError && <p style={{ color: "#f59e0b", fontSize: 13, margin: "8px 0 0" }}>API: {apiError}</p>}
      </div>

      {createdJob && (
        <JobStatusCard
          jobId={BigInt(createdJob.jobId)}
          job={createdJob}
          events={events}
          onLogEvent={logEvent}
        />
      )}
    </div>
  );
}

export default function Home() {
  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: 32, color: "#e2e8f0" }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28, color: "#f8fafc" }}>PayFi PayStream</h1>
        <p style={{ color: "#64748b", margin: "4px 0 16px" }}>AI-gated freelance payment escrow on Somnia Agentic L1</p>
        <ConnectWallet />
      </div>
      <CreateJobForm />
    </main>
  );
}
