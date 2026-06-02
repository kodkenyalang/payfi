"use client";
import { useWatchContractEvent } from "wagmi";
import escrowAbi from "@payfi/types/abis/FlowFiEscrow.json";
import { ESCROW_ADDRESS } from "../lib/config";

interface UseJobEventsProps {
  jobId: bigint;
  onPaymentReleased?: (tokenId: bigint) => void;
  onEvaluationComplete?: (score: bigint, reason: string) => void;
  onPaymentDisputed?: (score: bigint) => void;
  onPaymentRefunded?: () => void;
}

export function useJobEvents({
  jobId, onPaymentReleased, onEvaluationComplete, onPaymentDisputed, onPaymentRefunded
}: UseJobEventsProps) {

  useWatchContractEvent({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    eventName: "PaymentReleased",
    onLogs: (logs: any) => {
      const log = logs.find((l: any) => l.args?.jobId === jobId);
      if (log) onPaymentReleased?.(log.args.nftTokenId);
    }
  });

  useWatchContractEvent({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    eventName: "EvaluationComplete",
    onLogs: (logs: any) => {
      const log = logs.find((l: any) => l.args?.jobId === jobId);
      if (log) onEvaluationComplete?.(log.args.score, log.args.reason);
    }
  });

  useWatchContractEvent({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    eventName: "PaymentDisputed",
    onLogs: (logs: any) => {
      const log = logs.find((l: any) => l.args?.jobId === jobId);
      if (log) onPaymentDisputed?.(log.args.score);
    }
  });

  useWatchContractEvent({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    eventName: "PaymentRefunded",
    onLogs: (logs: any) => {
      const log = logs.find((l: any) => l.args?.jobId === jobId);
      if (log) onPaymentRefunded?.();
    }
  });
}
