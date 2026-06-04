"use client";
import { useWatchContractEvent } from "wagmi";
import escrowAbi from "@payfi/types/abis/FlowFiEscrow.json";
import { ESCROW_ADDRESS } from "../lib/config";

interface OnLogMeta {
  txHash: string;
  blockNumber: bigint;
}

interface UseJobEventsProps {
  jobId: bigint;
  onPaymentReleased?: (tokenId: bigint, meta: OnLogMeta) => void;
  onEvaluationComplete?: (score: bigint, reason: string, meta: OnLogMeta) => void;
  onEvaluationRequested?: (agentRequestId: bigint, meta: OnLogMeta) => void;
  onPaymentDisputed?: (score: bigint, meta: OnLogMeta) => void;
  onPaymentRefunded?: (meta: OnLogMeta) => void;
}

function pick<T>(logs: any[], jobId: bigint): { args: any; meta: OnLogMeta } | null {
  const log = logs.find((l: any) => l.args?.jobId === jobId);
  if (!log) return null;
  return {
    args: log.args,
    meta: {
      txHash: log.transactionHash as string,
      blockNumber: log.blockNumber as bigint,
    },
  };
}

export function useJobEvents({
  jobId, onPaymentReleased, onEvaluationComplete, onEvaluationRequested, onPaymentDisputed, onPaymentRefunded
}: UseJobEventsProps) {

  useWatchContractEvent({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    eventName: "PaymentReleased",
    onLogs: (logs: any) => {
      const found = pick(logs, jobId);
      if (found) onPaymentReleased?.(found.args.nftTokenId, found.meta);
    }
  });

  useWatchContractEvent({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    eventName: "EvaluationComplete",
    onLogs: (logs: any) => {
      const found = pick(logs, jobId);
      if (found) onEvaluationComplete?.(found.args.score, found.args.reason, found.meta);
    }
  });

  useWatchContractEvent({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    eventName: "EvaluationRequested",
    onLogs: (logs: any) => {
      const found = pick(logs, jobId);
      if (found) onEvaluationRequested?.(found.args.agentRequestId, found.meta);
    }
  });

  useWatchContractEvent({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    eventName: "PaymentDisputed",
    onLogs: (logs: any) => {
      const found = pick(logs, jobId);
      if (found) onPaymentDisputed?.(found.args.score, found.meta);
    }
  });

  useWatchContractEvent({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    eventName: "PaymentRefunded",
    onLogs: (logs: any) => {
      const found = pick(logs, jobId);
      if (found) onPaymentRefunded?.(found.meta);
    }
  });
}
