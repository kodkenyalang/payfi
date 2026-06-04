# Deployment Guide

## Current Deployment (Somnia Testnet)

| Contract | Address | Notes |
|---|---|---|
| **FlowFiEscrow** | `0x02916cDd952157156d17A255204462e40E90f129` | Core escrow with `IAgent.inferString` integration |
| **FlowNFT** | `0x065A50600376B537Ef5bE32cfc822a9DbCaD6399` | ERC721 payment receipt |
| **Somnia Platform** | `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776` | UUPS proxy (EIP-1967) |
| **Platform Impl** | `0xc49e656b0F3F039Ff43Fd9b900D19a852Fb68068` | Implementation behind proxy |
| **Agent Registry** | `0x08D1Fc808f1983d2Ea7B63a28ECD4d8C885Cd02A` | 3 agents registered |
| **LLM Agent ID** | `12847293847561029384` | uint256, cost 0.07 STT per agent |
| **Deploy Block** | `398450593` | Used as event polling start point |
| **Deployer** | `0xF639694848072E2d1fa77371707f33663B6eeA86` | Balance: ~96 STT remaining |

### Agent Configuration

```
LLM_INFERENCE_AGENT_ID = 12847293847561029384
PER_AGENT_COST         = 0.07 STT
RESERVE_DEPOSIT        = 0.03 STT  (from platform getRequestDeposit())
NUM_VALIDATORS         = 3
TOTAL_DEPOSIT          = 0.03 + (0.07 × 3) = 0.24 STT
```

Job amounts must be **> 0.24 STT** to cover the platform deposit.

---

## Prerequisites

- Node.js 20+
- npm 10+
- [Neon](https://neon.tech) PostgreSQL project
- [Upstash](https://upstash.com) Redis database
- [Render](https://render.com) account (for production deployment)
- Somnia testnet wallet funded with STT (faucet available via Somnia Discord)

---

## Environment Variables

### API (`apps/api/.env`)

| Variable | Required | Current Value |
|---|---|---|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |
| `REDIS_URL` | Yes | Upstash Redis URL (`redis://default:<token>@<host>:6379`) |
| `SOMNIA_RPC_URL` | Yes | `https://dream-rpc.somnia.network` |
| `DEPLOYER_PRIVATE_KEY` | Yes | Deployer wallet private key |
| `ESCROW_ADDRESS` | Yes | `0x02916cDd952157156d17A255204462e40E90f129` |
| `NFT_ADDRESS` | Yes | `0x065A50600376B537Ef5bE32cfc822a9DbCaD6399` |
| `DEPLOY_BLOCK` | Yes | `398450593` |
| `PORT` | No | Default `3001` |

### Web (`apps/web/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | API service URL (e.g., `http://localhost:3001`) |
| `NEXT_PUBLIC_SOMNIA_RPC_URL` | Yes | `https://dream-rpc.somnia.network` |
| `NEXT_PUBLIC_ESCROW_ADDRESS` | Yes | `0x02916cDd952157156d17A255204462e40E90f129` |
| `NEXT_PUBLIC_NFT_ADDRESS` | Yes | `0x065A50600376B537Ef5bE32cfc822a9DbCaD6399` |
| `NEXT_PUBLIC_CHAIN_ID` | Yes | `50312` |

---

## Deploy Contracts

```bash
cd apps/contracts

# Setup
cp .env.example .env
# Edit .env:
#   SOMNIA_RPC_URL=https://dream-rpc.somnia.network
#   DEPLOYER_PRIVATE_KEY=<your funded wallet>
#   SOMNIA_PLATFORM_ADDRESS=0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
#   SOMNIA_LLM_INFERENCE_AGENT_ID=12847293847561029384
#   SOMNIA_LLM_COST_PER_AGENT=70000000000000000

# Deploy
npx hardhat run scripts/deploy.ts --network somnia_testnet

# Smoke test
npx hardhat run scripts/e2e-testnet.ts --network somnia_testnet
```

---

## Deploy to Render

### 1. Fork / Push to GitHub

```bash
git remote add origin git@github.com:<your-org>/payfi-paystream.git
git push -u origin main
```

### 2. Create PostgreSQL on Neon

1. Go to [neon.tech](https://neon.tech) → Create project
2. Copy pooled connection string
3. Run migrations: `cd apps/api && npx prisma db push`

### 3. Create Redis on Upstash

1. Go to [upstash.com](https://upstash.com) → Create Redis database
2. Copy the endpoint URL and password
3. Set `REDIS_URL=redis://default:<password>@<endpoint>:6379`

### 4. Deploy on Render

Use the existing `render.yaml` blueprint:

| Service | Type | Plan | Notes |
|---|---|---|---|---|
| `payfi-api` | Web | Starter | Health check at `/api/health`, includes internal deadline checker |
| `payfi-web` | Web | Starter (free) | Connects to API via internal hostname |

**Manual steps:**
1. Go to Render Dashboard → Blueprint → `render.yaml`
2. For each service, manually fill the synced env vars:
   - `payfi-api`: `DATABASE_URL`, `REDIS_URL`, `DEPLOYER_PRIVATE_KEY`

### 5. Verify

```bash
# Health check
curl https://payfi-api.onrender.com/api/health

# List jobs
curl https://payfi-api.onrender.com/api/jobs
```

---

## E2E Test (Local)

```bash
cd apps/contracts
npx hardhat run scripts/e2e-testnet.ts --network somnia_testnet
```

Expected output (all 10 checks passing):

```
─── Results: 10 passed, 0 failed, 0 skipped ───
Final job state:
  status:      COMPLETE
  amount:      0.0 STT
  evalScore:   85
  evalReason:  "The project meets most requirements..."
```

---

## Local Development Stack

```bash
# Terminal 1: API
cd apps/api
npx tsx src/server.ts        # http://localhost:3001

# Terminal 2: Web
cd apps/web
npx next dev -p 3000         # http://localhost:3000
```

MetaMask configuration:
- Network name: Somnia Testnet
- RPC URL: `https://dream-rpc.somnia.network`
- Chain ID: `50312`
- Currency symbol: `STT`
- Block Explorer: `https://shannon-explorer.somnia.network`

---

## Architecture Notes

### Event Polling (No WebSocket)

Somnia's `dream-rpc.somnia.network` does not support WebSocket. The API uses HTTP polling with `getContractEvents`:

- Interval: 12 seconds
- Batch: 500 blocks per poll (Somnia RPC limits `eth_getLogs` range to 1000)
- Self-healing: each cycle is isolated; one failure doesn't cascade
- Config: `DEPLOY_BLOCK` determines where polling starts

### DB as Cache

PostgreSQL mirrors on-chain state. To rebuild from scratch:

```bash
npx prisma db push
# Restart API — polling will catch up from DEPLOY_BLOCK
```

### BullMQ (Graceful Degradation)

If Redis is unavailable or a placeholder URL is detected, BullMQ skips initialization entirely. The `evaluationQueue.add()` call is null-guarded in the submit route. Works fine without Redis — URL reachability checks are disabled but all other functionality works.

### Deadline Checker (Merged Into API)

The cron service is merged directly into the API as an internal `setInterval`:

- Frequency: Every 6 hours (first check runs immediately on startup)
- Scope: Queries DB for FUNDED/SUBMITTED jobs where `deadlineAt < now + 24h`
- Action: Logs warnings for at-risk jobs
- Chaos engineering: Wrapped in try/catch — one failure never crashes the API or stops the next cycle. No `CRON_SECRET` auth needed (no external trigger). No external service dependency. Self-contained within the API process.
