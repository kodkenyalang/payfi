# PayFi PayStream

On-chain escrow and AI-powered deliverable evaluation for freelance payments on Somnia Agentic L1.

## Architecture

```
apps/
├── contracts/    # Solidity smart contracts (Hardhat)
├── api/          # Express.js backend with Prisma + BullMQ
└── web/          # Next.js 14 frontend (wagmi + RainbowKit)
packages/
└── types/        # Shared TypeScript types + ABIs + deployments.json
```

## Smart Contracts

| Contract | Address (Somnia) | Description |
|---|---|---|
| `FlowFiEscrow` | `0x1aB4A7DB253c7Ac1BB7A970bd69Dff728d09788e` | Central escrow state machine. Manages job lifecycle: FUNDED → SUBMITTED → EVALUATING → COMPLETE/DISPUTED/REFUNDED. Integrates directly with Somnia platform via `IAgentRequester.createRequest` / `IAgentRequesterHandler.handleResponse`. |
| `FlowNFT` | `0xc2597766E4209b4c356df6D2568ebd9cfF744092` | On-chain ERC721 payment receipt. Fully self-contained base64 metadata — no IPFS dependency. Single-use minter set to escrow at deploy time. |

### State Machine

```
FUNDED → SUBMITTED → EVALUATING → COMPLETE  (score ≥ 80, NFT minted)
                                 → DISPUTED  (50–79, client can override)
                                 → REFUNDED  (score < 50)
FUNDED|SUBMITTED + timeout → REFUNDED
```

### Somnia Platform Integration

Rather than using custom oracle/evaluator contracts, `FlowFiEscrow` implements the exact Somnia Agentic L1 interfaces:

- **`IAgentRequester.createRequest`** — invoked in `invokeEvaluation()` to request AI evaluation of submitted work. The agent prompt is built on-chain from the job requirements and deliverable URL.
- **`IAgentRequesterHandler.handleResponse`** — called back by the platform with evaluation results. Expects JSON `{"score":<0-100>,"reason":"<string>"}`. Handles all edge cases: empty bytes → refund, parse error → refund, score thresholds as above.

The `MockAgentRequester` used in tests calls `handleResponse` synchronously, enabling deterministic testing without wait/fulfill steps.

### Domain Allowlist

`submitWork` enforces a domain allowlist on the deliverable URL:

- `github.com` — `notion.so` — `figma.com` — `docs.google.com` — `linear.app`

Both `https://` and `http://` are accepted. Bare domains (without protocol) are rejected.

## Getting Started

```bash
# Install dependencies
npm install

# Compile contracts
npm run build --filter=contracts

# Run tests (57 passing)
npm run test --filter=contracts

# Export ABIs to packages/types
npm run export-abis
```

### Deploy to Somnia Testnet

```bash
cp apps/contracts/.env.example apps/contracts/.env
# Fill in: SOMNIA_RPC_URL (https://dream-rpc.somnia.network),
#          DEPLOYER_PRIVATE_KEY, LLM_AGENT_ID,
#          PLATFORM_CONTRACT_ADDRESS
npm run deploy:contracts
```

### API Configuration

All 9 required env vars (see `apps/api/.env`):

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `REDIS_URL` | Upstash Redis connection string |
| `SOMNIA_RPC_URL` | Somnia RPC endpoint (`https://dream-rpc.somnia.network`) |
| `DEPLOYER_PRIVATE_KEY` | Wallet key for on-chain writes |
| `CRON_SECRET` | Shared secret for cron job auth |
| `ESCROW_ADDRESS` | Deployed `FlowFiEscrow` address |
| `NFT_ADDRESS` | Deployed `FlowNFT` address |
| `DEPLOY_BLOCK` | Block number the contracts were deployed at (for event polling) |

## Design Principles

- **Blast radius containment**: Each component's failure cannot cascade. Smart contract failures don't lock funds. API failures don't corrupt chain state.
- **DB is a cache**: PostgreSQL mirrors on-chain state. Source of truth is always the chain. Re-indexing from `deployBlock` restores all state.
- **Chaos-engineering-first**: Every external call has a defined fallback. AI agent timeout → `claimRefundAfterTimeout`. Parse failure → automatic refund via `string()` cast that never reverts.
- **One-piece flow**: Complete and test each module before starting the next. No work-in-progress accumulation.
- **HTTP polling, not WebSocket**: `dream-rpc.somnia.network` does not support WebSocket. Event listener uses `getContractEvents` at 12s intervals with per-cycle error isolation and self-healing.
