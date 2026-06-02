"use client";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { injected } from "wagmi/connectors";
import escrowAbi from "@payfi/types/abis/FlowFiEscrow.json";
import { ESCROW_ADDRESS } from "../lib/config";
import { useState } from "react";

function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    return (
      <div>
        <span>{address?.slice(0, 6)}...{address?.slice(-4)}</span>
        <button onClick={() => disconnect()}>Disconnect</button>
      </div>
    );
  }

  return <button onClick={() => connect({ connector: injected() })}>Connect Wallet</button>;
}

function CreateJobForm() {
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const [freelancer, setFreelancer] = useState("");
  const [requirements, setRequirements] = useState("");
  const [deliverableUrl, setDeliverableUrl] = useState("https://github.com/");
  const [deadline, setDeadline] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 16);
  });
  const [amount, setAmount] = useState("0.1");

  const label = isPending ? "Confirm in wallet..." :
    isConfirming ? "Submitting to chain..." :
    isSuccess ? "Job Created!" :
    "Create Job";

  const handleCreate = () => {
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
    <div style={{ border: "1px solid #ccc", padding: 16, margin: 16, borderRadius: 8 }}>
      <h2>Create Job</h2>
      <input placeholder="Freelancer address" value={freelancer} onChange={e => setFreelancer(e.target.value)} /><br />
      <input placeholder="Requirements" value={requirements} onChange={e => setRequirements(e.target.value)} /><br />
      <input placeholder="Deliverable URL" value={deliverableUrl} onChange={e => setDeliverableUrl(e.target.value)} /><br />
      <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} /><br />
      <input placeholder="Amount (STT)" value={amount} onChange={e => setAmount(e.target.value)} /><br />
      <button onClick={handleCreate} disabled={isPending || isConfirming || isSuccess}>
        {label}
      </button>
      {error && <p style={{ color: "red" }}>Error: {error.message}</p>}
    </div>
  );
}

export default function Home() {
  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <h1>PayFi PayStream</h1>
      <p>AI-gated freelance payment escrow on Somnia Agentic L1</p>
      <ConnectWallet />
      <CreateJobForm />
    </main>
  );
}
