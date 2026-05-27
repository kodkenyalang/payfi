# PayFi PayStream

On-chain escrow and AI-powered deliverable evaluation for freelance payments on Somnia.

## Architecture

```
apps/
├── contracts/    # Solidity smart contracts (Hardhat)
├── api/          # Express.js backend with Prisma + BullMQ
└── web/          # Next.js 14 frontend
packages/
└── types/        # Shared TypeScript types + ABIs
```

## Smart Contracts

| Contract | Description |
|---|---|
| `FlowFiEscrow` | Central escrow state machine. Manages job lifecycle: FUNDED → SUBMITTED → EVALUATING → COMPLETE/DISPUTED/REFUNDED. Holds funds, enforces timeouts, coordinates oracle calls. |
| `CompletionEvaluator` | Sends deliverable content to Somnia LLMInference agent. Parses JSON score responses. Never reverts on bad input — parse errors trigger refund path. |
| `DeliverableOracle` | Scrapes deliverable URLs via Somnia LLMParseWebsite agent. Enforces domain allowlist (github.com, notion.so, figma.com, etc). |
| `FlowNFT` | On-chain ERC721 payment receipt. Fully self-contained base64 metadata — no IPFS dependency. Single-use minter set to escrow. |

### State Machine

```
FUNDED → SUBMITTED → EVALUATING → COMPLETE (score ≥ 80)
                                 → DISPUTED (50-79) → clientOverride
                                 → REFUNDED (score < 50)
FUNDED|SUBMITTED + timeout → REFUNDED
```

## Getting Started

```bash
# Install dependencies
npm install

# Compile contracts
npm run build --filter=contracts

# Run tests
npm run test --filter=contracts

# Export ABIs
npm run export-abis
```

### Deploy to Somnia Devnet

```bash
cp apps/contracts/.env.example apps/contracts/.env
# Fill in SOMNIA_RPC_URL, DEPLOYER_PRIVATE_KEY, Somnia agent addresses
npm run deploy:contracts
```

## Design Principles

- **Blast radius containment**: Each component's failure cannot cascade. Smart contract failures don't lock funds. API failures don't corrupt chain state.
- **DB is a cache**: PostgreSQL mirrors on-chain state. Source of truth is always the chain. Re-indexing from `deployBlock` restores all state.
- **Chaos-engineering-first**: Every external call has a defined fallback. AI agent timeout → `claimRefundAfterTimeout`. Parse failure → automatic refund.
- **One-piece flow**: Complete and test each module before starting the next. No work-in-progress accumulation.
