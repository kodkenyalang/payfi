export type AgentEventType =
  | "agent.invoked"
  | "agent.reasoning"
  | "agent.decision"
  | "agent.tx.submitted"
  | "agent.tx.confirmed"
  | "agent.tx.failed";

export interface AgentEvent {
  type: AgentEventType;
  jobId: number;
  timestamp: string;
  payload: {
    reasoning?: string;
    decision?: "approve" | "reject" | "pending";
    confidence?: number;
    txHash?: string;
    blockNumber?: number;
    error?: string;
  };
}
