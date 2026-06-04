"use client";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { injected } from "wagmi/connectors";
import escrowAbi from "@payfi/types/abis/FlowFiEscrow.json";
import { ESCROW_ADDRESS, API_URL } from "../lib/config";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useJobEvents } from "../hooks/useJobEvents";
import { bigIntReplacer } from "../utils/bigint-serializer";
import { formatEther } from "viem";

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
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return <div style={{ height: 44 }} />;
  }

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

interface StructuredEvent {
  id: number;
  time: string;
  icon: string;
  label: string;
  detail?: string;
  txHash?: string;
  link?: string;
}

const SOMNIA_EXPLORER = "https://shannon-explorer.somnia.network";

function EventLog({ events, txHash: jobTxHash }: { events: StructuredEvent[]; txHash?: string }) {
  if (events.length === 0) return null;
  return (
    <div style={{ marginTop: 16, padding: 12, background: "#0f172a", borderRadius: 8, border: "1px solid #1e293b" }}>
      <h4 style={{ margin: "0 0 8px", color: "#94a3b8", fontSize: 13 }}>Live Events</h4>
      {jobTxHash && (
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8, fontFamily: "monospace" }}>
          Tx:{" "}
          <a href={`${SOMNIA_EXPLORER}/tx/${jobTxHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#38bdf8" }}>
            {jobTxHash.slice(0, 10)}...{jobTxHash.slice(-6)}
          </a>
        </div>
      )}
      {events.map((e) => (
        <div key={e.id} style={{ fontSize: 13, fontFamily: "monospace", padding: "3px 0", borderBottom: "1px solid #1e293b" }}>
          <span style={{ color: "#64748b", marginRight: 8 }}>{e.time}</span>
          <span style={{ marginRight: 4 }}>{e.icon}</span>
          <span style={{ color: e.txHash ? "#22d3ee" : "#e2e8f0" }}>{e.label}</span>
          {e.detail && (
            <div style={{ color: "#94a3b8", paddingLeft: 20, marginTop: 2, fontSize: 12, whiteSpace: "pre-wrap" }}>{e.detail}</div>
          )}
          {e.txHash && (
            <div style={{ paddingLeft: 20, marginTop: 1 }}>
              <a href={`${SOMNIA_EXPLORER}/tx/${e.txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#38bdf8", fontSize: 11 }}>
                {e.txHash.slice(0, 10)}...{e.txHash.slice(-6)}
              </a>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function JobStatusCard({ jobId, job, structuredEvents, onLogEvent, jobTxHash }: { jobId: bigint; job: JobInfo | null; structuredEvents: StructuredEvent[]; onLogEvent: (e: StructuredEvent) => void; jobTxHash?: string }) {
  const [fetchedJob, setFetchedJob] = useState<JobInfo | null>(job);
  let eventId = useRef(0);

  useJobEvents({
    jobId,
    onEvaluationComplete: (score, reason, meta) => {
      const label = score >= 80 ? "Agent approved payment" : score >= 50 ? "Agent disputed payment" : "Agent rejected payment";
      onLogEvent({
        id: ++eventId.current,
        time: new Date().toLocaleTimeString(),
        icon: score >= 80 ? "✅" : score >= 50 ? "⚖️" : "❌",
        label,
        detail: `Score: ${score}\nReason: ${reason}`,
        txHash: meta.txHash,
      });
      refreshJob();
    },
    onEvaluationRequested: (agentRequestId, meta) => {
      onLogEvent({
        id: ++eventId.current,
        time: new Date().toLocaleTimeString(),
        icon: "🤖",
        label: "Inference agent invoked",
        detail: `Agent request ID: ${agentRequestId}`,
        txHash: meta.txHash,
      });
    },
    onPaymentReleased: (tokenId, meta) => {
      onLogEvent({
        id: ++eventId.current,
        time: new Date().toLocaleTimeString(),
        icon: "💰",
        label: "Payment released to freelancer",
        detail: `NFT #${tokenId} minted`,
        txHash: meta.txHash,
      });
      refreshJob();
    },
    onPaymentDisputed: (score, meta) => {
      onLogEvent({
        id: ++eventId.current,
        time: new Date().toLocaleTimeString(),
        icon: "⚠️",
        label: "Payment disputed",
        detail: `Score: ${score} — client can override`,
        txHash: meta.txHash,
      });
      refreshJob();
    },
    onPaymentRefunded: (meta) => {
      onLogEvent({
        id: ++eventId.current,
        time: new Date().toLocaleTimeString(),
        icon: "↩️",
        label: "Payment refunded to client",
        txHash: meta.txHash,
      });
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
        <span>Amount:</span><span style={{ color: "#cbd5e1" }}>{formatEther(BigInt(display.amountWei))} STT</span>
        <span>Requirements:</span><span style={{ color: "#cbd5e1" }}>{display.requirements}</span>
        <span>Deliverable:</span><span style={{ color: "#cbd5e1", fontFamily: "monospace", fontSize: 12 }}>{display.deliverableUrl}</span>
      </div>
      <EventLog events={structuredEvents} txHash={jobTxHash} />
    </div>
  );
}

function CreateJobForm() {
  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

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
  const [structuredEvents, setStructuredEvents] = useState<StructuredEvent[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [displayTxHash, setDisplayTxHash] = useState<string | null>(null);
  const submittingRef = useRef(false);
  let eventId = useRef(0);

  const logEvent = useCallback((e: StructuredEvent) => {
    setStructuredEvents(prev => [...prev, e]);
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    if (window.ethereum.setMaxListeners) {
      window.ethereum.setMaxListeners(20);
    }
    const handleAccountsChanged = (accounts: unknown[]) => {
      if ((accounts as string[]).length === 0) setCreatedJob(null);
    };
    const handleChainChanged = () => {
      setCreatedJob(null);
    };
    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);
    return () => {
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, []);

  useEffect(() => {
    if (!isSuccess || !txHash) return;

    setApiError("");
    setDisplayTxHash(txHash);

    fetch(`${API_URL}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactionHash: txHash,
        deliverableUrl,
        requirements
      }, bigIntReplacer)
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
        logEvent({
          id: ++eventId.current,
          time: new Date().toLocaleTimeString(),
          icon: "📝",
          label: `Job #${job.jobId} created on-chain and persisted in API`,
          txHash,
        });
      })
      .catch((err) => {
        setApiError(err.message);
        setDisplayTxHash(null);
      });
  }, [isSuccess, txHash, deliverableUrl, requirements, logEvent]);

  const hasError = !!writeError || !!apiError;
  const txState = hasError && !isPending && !isConfirming ? "error" :
    isPending ? "pending" :
    isConfirming ? "confirming" :
    isSuccess ? "success" :
    isSubmitting ? "pending" :
    "idle" as const;

  const buttonLabel = txState === "error" ? "Try Again" :
    txState === "pending" ? "Confirm in wallet..." :
    txState === "confirming" ? "Submitting to chain..." :
    txState === "success" ? "Job Created!" :
    "Create Job";

  const handleCreate = () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setCreatedJob(null);
    setApiError("");
    setDisplayTxHash(null);
    setStructuredEvents([]);
    try {
      const deadlineTs = BigInt(Math.floor(new Date(deadline).getTime() / 1000));
      writeContract({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: "createJob",
        args: [freelancer as `0x${string}`, requirements, deliverableUrl, deadlineTs],
        value: BigInt(Math.floor(parseFloat(amount) * 1e18))
      });
    } catch (err) {
      submittingRef.current = false;
      setIsSubmitting(false);
      setApiError(err instanceof Error ? err.message : "Failed to create job");
    }
  };

  useEffect(() => {
    if (!isPending && !isConfirming && !isSuccess) {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [isPending, isConfirming, isSuccess]);

  if (!mounted) {
    return <div style={{ height: 320 }} />;
  }

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
          <button onClick={handleCreate} disabled={txState === "pending" || txState === "confirming" || txState === "success"}
            style={{ padding: "12px 24px", borderRadius: 8, border: "none", cursor: txState === "pending" || txState === "confirming" ? "wait" : "pointer", fontWeight: 600, background: txState === "success" ? "#22c55e" : txState === "error" ? "#ef4444" : "#3b82f6", color: "#fff", opacity: txState === "pending" || txState === "confirming" ? 0.7 : 1 }}>
            {buttonLabel}
          </button>
        </div>
        {displayTxHash && (
          <p style={{ color: "#94a3b8", fontSize: 12, margin: "8px 0 0", fontFamily: "monospace" }}>
            Tx:{" "}
            <a href={`${SOMNIA_EXPLORER}/tx/${displayTxHash}`} target="_blank" rel="noopener noreferrer" style={{ color: "#38bdf8" }}>
              {displayTxHash.slice(0, 10)}...{displayTxHash.slice(-6)}
            </a>
          </p>
        )}
        {writeError && <p style={{ color: "#ef4444", fontSize: 13, margin: "8px 0 0" }}>{writeError.message}</p>}
        {apiError && <p style={{ color: "#f59e0b", fontSize: 13, margin: "8px 0 0" }}>API: {apiError}</p>}
      </div>

      {createdJob && (
        <JobStatusCard
          jobId={BigInt(createdJob.jobId)}
          job={createdJob}
          structuredEvents={structuredEvents}
          onLogEvent={logEvent}
          jobTxHash={displayTxHash || undefined}
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
        <Suspense fallback={<div style={{ height: 44 }} />}>
          <ConnectWallet />
        </Suspense>
      </div>
      <Suspense fallback={<div style={{ height: 320 }} />}>
        <CreateJobForm />
      </Suspense>
    </main>
  );
}
