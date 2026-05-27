export enum JobStatus {
  FUNDED     = 0,
  SUBMITTED  = 1,
  EVALUATING = 2,
  COMPLETE   = 3,
  DISPUTED   = 4,
  REFUNDED   = 5
}

export interface Job {
  jobId: bigint;
  client: string;
  freelancer: string;
  amount: bigint;
  deliverableUrl: string;
  requirements: string;
  deadline: bigint;
  status: JobStatus;
  evaluationScore: bigint;
  evaluationReason: string;
  submittedAt: bigint;
}

export interface EvaluationResult {
  score: number;
  reason: string;
  jobId: bigint;
  transactionHash: string;
}

export interface DeploymentAddresses {
  chainId: string;
  escrow: string;
  oracle: string;
  evaluator: string;
  nft: string;
  deployBlock: number;
  deployedAt: string;
}

export { default as deployments } from "./deployments.json";
