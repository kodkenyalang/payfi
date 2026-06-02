# E2E Evaluation Matrix

## Legend
- `✅` Pass
- `❌` Fail
- `⏳` Pending — requires correct LLM agent ID from Somnia Agent Explorer
- `—` Not applicable

---

## A. Contract State Machine

| # | Scenario | Flow | Expected Final Status | EVAL Ref | Local | Testnet |
|---|---|---|---|---|---|---|
| 1 | Happy path score=85 | createJob(FUNDED) → submitWork(SUBMITTED) → invokeEvaluation(EVALUATING) → handleResponse(score=85) | COMPLETE + NFT minted | EVAL-01 | ✅ | ⏳ |
| 2 | Score threshold = 80 | Same, score=80 | COMPLETE + NFT minted | EVAL-11a | ✅ | ⏳ |
| 3 | Score threshold = 50 | Same, score=50 | DISPUTED | EVAL-11b | ✅ | ⏳ |
| 4 | Below dispute = 49 | Same, score=49 | REFUNDED | EVAL-11c | ✅ | ⏳ |
| 5 | Empty result bytes | invokeEvaluation → handleResponse(empty) | REFUNDED | EVAL-10a | ✅ | ⏳ |
| 6 | Agent TimedOut | invokeEvaluation → handleResponse(TimedOut) | REFUNDED + AgentTimedOut | EVAL-03 | ✅ | ⏳ |
| 7 | Client override → approve | score=55 → DISPUTED → clientOverride(true) | COMPLETE | EVAL-05 | ✅ | ⏳ |
| 8 | Client override → refund | score=55 → DISPUTED → clientOverride(false) | REFUNDED | EVAL-05 | ✅ | ⏳ |
| 9 | Timeout from FUNDED | createJob → wait deadline+3d → claimRefundAfterTimeout | REFUNDED | EVAL-02 | ✅ | ⏳ |
|10 | Timeout from SUBMITTED | createJob → submitWork → wait deadline+3d → claimRefundAfterTimeout | REFUNDED | EVAL-02 | ✅ | ⏳ |
|11 | invokeEvaluation from FUNDED | Wrong revert | FUNDED | EVAL-12a | ✅ | ⏳ |
|12 | invokeEvaluation from COMPLETE | Wrong revert | COMPLETE | EVAL-12b | ✅ | ⏳ |
|13 | invokeEvaluation from DISPUTED | Wrong revert | DISPUTED | EVAL-12c | ✅ | ⏳ |
|14 | invokeEvaluation from REFUNDED | Wrong revert | REFUNDED | EVAL-12d | ✅ | ⏳ |
|15 | Pause blocks all state changes | pause → createJob/submitWork | Reverts when paused | EVAL-09 | ✅ | ⏳ |

## B. Domain Allowlist

| # | Input | Expected | EVAL Ref | Local | Testnet |
|---|---|---|---|---|---|
| 1 | `https://github.com/user/repo` | Allowed | EVAL-13 | ✅ | ✅ |
| 2 | `http://github.com/repo` (no https) | Allowed | EVAL-13a | ✅ | ✅ |
| 3 | `github.com/repo` (no protocol) | Rejected | EVAL-13b | ✅ | ✅ |
| 4 | `https://evil.com/pay` (unknown domain) | Rejected | EVAL-13c | ✅ | ✅ |
| 5 | `https://notion.so/doc` | Allowed | — | ✅ | ✅ |
| 6 | `https://figma.com/file` | Allowed | — | ✅ | ✅ |
| 7 | `https://docs.google.com/doc` | Allowed | — | ✅ | ✅ |
| 8 | `https://linear.app/issue` | Allowed | — | ✅ | ✅ |

## C. API Routes

| # | Method | Route | Auth | Expected | Local | Testnet |
|---|---|---|---|---|---|---|
| 1 | POST | /api/jobs | None | Creates job in DB, returns jobId and tx | — | ⏳ |
| 2 | GET | /api/jobs | None | Returns job list from DB | — | ⏳ |
| 3 | GET | /api/jobs/:id | None | Returns single job | — | ⏳ |
| 4 | GET | /api/health | None | Returns `{"status":"ok"}` | — | ⏳ |
| 5 | POST | /api/cron/check-deadlines | x-cron-secret | Claims expired timeouts | — | ⏳ |

## D. Event Listener (HTTP Polling)

| # | Scenario | Expected | Status |
|---|---|---|---|
| 1 | New on-chain event → poller picks it up within 12s | DB updated | ⏳ |
| 2 | RPC temporarily down → poller retries next cycle | No data loss, self-heals | ⏳ |
| 3 | Poller starts from DEPLOY_BLOCK | All historical events indexed | ⏳ |

## E. Frontend

| # | Action | Expected | Status |
|---|---|---|---|
| 1 | Connect wallet (RainbowKit) | Somnia testnet detected, wallet address shown | ⏳ |
| 2 | Fill create job form + submit | wagmi tx sent, JobCreated event received | ⏳ |
| 3 | View job list | Fetches from API, displays jobs | ⏳ |
| 4 | Wallet disconnect | Clears state, connect button shows | ⏳ |

## F. Chaos Engineering

| # | Scenario | Expected | Status |
|---|---|---|---|
| 1 | handleResponse called with wrong agentRequestId | Idempotent — returns without state change | ✅ |
| 2 | handleResponse called on non-EVALUATING job | Idempotent — returns without state change | ✅ |
| 3 | handleResponse reverts (platform bug) | Platform handles callback failure; event poller detects nothing | ✅ |
| 4 | NFT mint fails | PaymentReleased still fires with NFTMintFailed event | ✅ |
| 5 | Deployer wallet runs out of STT | invokeEvaluation reverts with InsufficientAgentDeposit | ✅ |
| 6 | HTTP poller error isolated per cycle | try/catch each cycle, next cycle unaffected | ✅ |

## G. Blast Radius

| # | Component Fails | Effect | Recovery |
|---|---|---|---|
| 1 | AI agent times out | Job goes to REFUNDED via timeout path | Client gets funds back |
| 2 | API crashes | On-chain state unaffected; events missed until restart | Poller catches up from DEPLOY_BLOCK |
| 3 | DB corrupted | Source of truth is chain | Re-index from DEPLOY_BLOCK |
| 4 | Frontend down | Users can interact via contracts directly | Just need a wallet |
| 5 | Deployer key compromised | Rotate key, redeploy contracts | Deploy new escrow with new key |
| 6 | Platform contract paused | invokeEvaluation reverts for new jobs | Jobs processed normally resume after unpause |

## Testnet E2E Results (2026-06-02)

```
─── Connectivity & Contract State ───
  ✔ Escrow exists (12288 bytes)
  ✔ NFT exists (6584 bytes)
  ✔ Platform proxy exists (delegates to implementation at 0xc49e656b...)
  ✔ NFT: PayStream Receipt (PSRX)
  ✔ Escrow config: platform=0x037Bb9C7.. nft=0xc2597766..
  ✔ Agent config: id=<pending>, cost=0.03 STT
  ✔ Platform getRequestDeposit() = 0.03 STT

─── Full Job Lifecycle ───
  ✔ createJob: jobId=8, status=FUNDED, amount=0.2 STT
  ✔ submitWork: status=SUBMITTED
  ⏳ invokeEvaluation: reverted — platform returned InvalidAgentId(1)
                       (agentId=1 is not registered; need correct LLM agent ID)

─── Results: 9 passed, 0 failed, 1 skipped ───
```

### Known Blockers

1. **LLM Agent ID unknown for testnet**: The configured `SOMNIA_LLM_INFERENCE_AGENT_ID=1` is incorrect. The correct LLM Inference agent ID must be obtained from:
   - [Somnia Agent Explorer](https://agents.testnet.somnia.network) (testnet)
   - Browse agents → find LLM Inference agent → copy its agent ID (uint256)

2. **Platform is a UUPS proxy** at `0x037Bb9C7...` delegating to implementation `0xc49e656b...`. All calls are forwarded via DELEGATECALL.

3. **Agent IDs are large uint256 values** — the JSON API agent ID is `13174292974160097713`, not a small integer. LLM agents use similarly large IDs.

## Running Locally

```bash
cd apps/contracts
npx hardhat test  # 57 tests, all passing
```

## Running on Testnet

```bash
cd apps/contracts
# First set correct LLM agent ID in .env:
#   SOMNIA_LLM_INFERENCE_AGENT_ID=<id from Agent Explorer>
npx hardhat run scripts/e2e-testnet.ts --network somnia_testnet
```
