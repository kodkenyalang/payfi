# Deployment Guide

## Prerequisites

- Node.js 20+
- npm 10+
- [Neon](https://neon.tech) PostgreSQL project
- [Upstash](https://upstash.com) Redis database
- [Render](https://render.com) account
- Somnia testnet wallet funded with STT (get from faucet)

## Environment Variables

### API (`apps/api/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |
| `REDIS_URL` | Yes | Upstash Redis REST URL (`rediss://...`) |
| `SOMNIA_RPC_URL` | Yes | `https://dream-rpc.somnia.network` |
| `DEPLOYER_PRIVATE_KEY` | Yes | Wallet private key for on-chain writes |
| `CRON_SECRET` | Yes | Shared secret for cron-to-API auth |
| `ESCROW_ADDRESS` | Yes | `0x1aB4A7DB253c7Ac1BB7A970bd69Dff728d09788e` |
| `NFT_ADDRESS` | Yes | `0xc2597766E4209b4c356df6D2568ebd9cfF744092` |
| `DEPLOY_BLOCK` | Yes | `398404163` |
| `PORT` | No | Default `3001` |

### Web (`apps/web/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | API service URL (Render internal hostname in prod) |
| `NEXT_PUBLIC_SOMNIA_RPC_URL` | Yes | `https://dream-rpc.somnia.network` |
| `NEXT_PUBLIC_ESCROW_ADDRESS` | Yes | `0x1aB4A7DB253c7Ac1BB7A970bd69Dff728d09788e` |
| `NEXT_PUBLIC_NFT_ADDRESS` | Yes | `0xc2597766E4209b4c356df6D2568ebd9cfF744092` |
| `NEXT_PUBLIC_CHAIN_ID` | Yes | `50312` |

## Deploy Contracts

```bash
cd apps/contracts

# Setup
cp .env.example .env
# Edit .env with:
#   SOMNIA_RPC_URL=https://dream-rpc.somnia.network
#   DEPLOYER_PRIVATE_KEY=<your funded wallet>

# Deploy
npm run deploy

# Smoke test
# The deploy script prints deployed addresses. Verify with:
cast code <ESCROW_ADDRESS> --rpc-url https://dream-rpc.somnia.network
```

## Deploy to Render

### 1. Fork / Push to GitHub

```bash
git remote add origin git@github.com:<your-org>/payfi-paystream.git
git push -u origin main
```

### 2. Create PostgreSQL on Neon

1. Go to [neon.tech](https://neon.tech) → Create project
2. Copy connection string (pooled: `postgres://...`)
3. Run migrations: `cd apps/api && npx prisma migrate deploy`

### 3. Create Redis on Upstash

1. Go to [upstash.com](https://upstash.com) → Create Redis database
2. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
3. Set `REDIS_URL` to `rediss://default:<token>@<endpoint>:6379`

### 4. Deploy on Render

Use the existing `render.yaml` blueprint:

| Service | Type | Plan | Notes |
|---|---|---|---|
| `payfi-api` | Web | Starter | Health check at `/api/health` |
| `payfi-web` | Web | Starter (free) | Connects to API via internal hostname |
| `payfi-cron-deadlines` | Cron | Free | Runs every 6 hours |

**Manual steps** (Render Blueprint doesn't support `sync: false`):
1. Go to Render Dashboard → Blueprint → `render.yaml`
2. For each service, manually fill the synced env vars:
   - `payfi-api`: `DATABASE_URL`, `REDIS_URL`, `DEPLOYER_PRIVATE_KEY`, `CRON_SECRET`
   - `payfi-cron-deadlines`: `CRON_SECRET`

**Important**: The API service hostname is auto-injected into the web service via `NEXT_PUBLIC_API_URL` (Render `fromService` reference).

### 5. Verify

```bash
# Health check
curl https://payfi-api.onrender.com/api/health

# List jobs
curl https://payfi-api.onrender.com/api/jobs
```

## Architecture Notes

### Event Polling (No WebSocket)

Somnia's `dream-rpc.somnia.network` does not support WebSocket. The API uses HTTP polling with `getContractEvents`:

- Interval: 12 seconds
- Batch: 5000 blocks per poll
- Self-healing: each cycle is isolated; one failure doesn't cascade
- Config: `DEPLOY_BLOCK` determines where polling starts

### DB as Cache

PostgreSQL mirrors on-chain state. To rebuild from scratch:

```bash
npx prisma migrate deploy
# Restart API — polling will catch up from DEPLOY_BLOCK
```

### Cron: Deadline Checker

Runs every 6 hours. Calls `/api/cron/check-deadlines` which:

1. Reads all FUNDED/SUBMITTED jobs from DB
2. Checks `block.timestamp > deadline + TIMEOUT_BUFFER` via RPC
3. Calls `claimRefundAfterTimeout` for timed-out jobs
4. Updates DB with REFUNDED status
