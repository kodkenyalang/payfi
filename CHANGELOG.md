# Changelog

## [0.3.0] — 2026-06-03

### Added
- **Full E2E testnet success**: All 10 checks passing on Somnia testnet.
  - `invokeEvaluation` accepted by platform → `agentRequestId = 3978875`
  - Platform callback in ~15s → `EvaluationComplete(score=85, "...")`
  - `PaymentReleased` → job COMPLETE, funds released autonomously
- **`IAgent.inferString` selector integration**: Payload uses `abi.encodeWithSelector(IAgent.inferString.selector, prompt, "", false, emptyAllowed)` per Somnia platform docs.
- **Frontend → API full loop**: After `createJob` tx confirms, frontend calls `POST /api/jobs` with tx hash; API parses `JobCreated` event and persists to Neon DB. `useJobEvents` hook shows real-time status updates.
- **Live event display**: JobStatusCard component polls API every 5s and watches on-chain events via `useWatchContractEvent`.

### Changed
- **Agent ID**: `1` → `12847293847561029384` (correct LLM Inference agent on Somnia testnet).
- **Per-agent cost**: 0.03 STT → 0.07 STT (matches Somnia LLM Inference agent spec).
- **Total deposit**: 0.031 STT → 0.24 STT (= 0.03 reserve + 0.07 × 3 validators).
- **E2E test job amount**: 0.2 STT → 0.5 STT (must be > total deposit 0.24 STT).
- **Event poller batch size**: 5000 → 500 blocks (Somnia RPC limits `eth_getLogs` range to 1000).
- **BullMQ Redis**: Made gracefully optional with placeholder detection, TLS support for Upstash, and `maxRetriesPerRequest: null`.
- **Event listener**: FK constraint violations silently handled (historical events for jobs not in DB).
- **Frontend layout**: Dark theme, RainbowKit provider, live job status card with event feed.

### Fixed
- `0x0ede9759` (`InvalidAgentId(1)`) — resolved by discovering correct agent ID `12847293847561029384` from Somnia docs.
- `0x85ad0db4...` — resolved by increasing job amount from 0.2 to 0.5 STT (> 0.24 total deposit).
- Frontend BigInt literal compatibility (ES2017 target does not support `100n` syntax).
- `pino-pretty` module resolution for Wagmi/RainbowKit in Next.js bundler.

### Security
- Deployer wallet key rotated. `.env` separated from `.env.example`.
- `evaluationQueue` null-guarded in submit route (BullMQ gracefully skips when Redis is a placeholder).
- Event handler wraps each Prisma operation in try/catch — one event failure never cascades.

### Deployment
- Current deployed addresses (Somnia testnet):
  - `FlowFiEscrow: 0x02916cDd952157156d17A255204462e40E90f129`
  - `FlowNFT: 0x065A50600376B537Ef5bE32cfc822a9DbCaD6399`
  - Deploy block: `398450593`
  - Agent ID: `12847293847561029384`, cost: `0.07 STT`
- Neon PostgreSQL provisioned and `prisma db push` applied.
- Upstash Redis provisioned and BullMQ worker initialized.
- Full local stack running: frontend (port 3000) ↔ API (port 3001) ↔ Somnia testnet.

## [0.2.1] — 2026-06-02

### Added
- E2E test matrix with 9/10 checks passing (invokeEvaluation blocked by unknown agent ID).
- Platform bytecode analysis tool (`scripts/analyze-platform.ts`) confirming UUPS proxy at `0x037Bb9C7...` delegating to `0xc49e656b...`.
- Agent ID discovery: Somnia agent IDs are large uint256 values (JSON API = `13174292974160097713`, LLM = `12847293847561029384`).
- Comprehensive README, CHANGELOG, DEPLOYMENT.md written.
- `EVAL_MATRIX.md` with 40+ scenarios across contract state machine, API, event listener, frontend, chaos engineering, and blast radius.

### Changed
- Somnia RPC from `shannon.sepolia.somnia.network` to `dream-rpc.somnia.network` in all configs.
- `apps/api/.env` updated with correct agent ID `12847293847561029384` and cost `0.07 STT`.
- Agent payload changed from `abi.encode(prompt)` to `abi.encodeWithSelector(IAgent.inferString.selector, prompt, "", false, emptyAllowed)`.

### Fixed
- `config.ts` lazy validation ensuring `dotenv.config()` runs before env validation.

## [0.2.0] — 2026-06-02

### Added
- `_decodeString` changed from `bytes calldata` + `abi.decode` to `bytes memory` + `string(raw)` cast — eliminates ABI encoding mismatch when called externally via `this._decodeString()`, never reverts.
- 17 new EVAL tests (EVAL-09 through EVAL-13): pause/unpause, empty result bytes, score boundary thresholds (80/50/49), WrongStatus from all non-EVALUATING states, domain allowlist edge cases.
- Chaos engineering tests: empty result bytes → refund, malformed JSON → refund via `string()` cast, HTTP polling self-healing per-cycle error isolation.
- Comprehensive eval matrix tracking all contract state machine transitions, API routes, blast radius analysis, and interaction map.

### Changed
- **Architecture**: Replaced 4-contract system (`FlowFiEscrow` + `CompletionEvaluator` + `DeliverableOracle` + `FlowNFT`) with 2 contracts (`FlowFiEscrow` + `FlowNFT`). Somnia platform integration uses direct `IAgentRequester`/`IAgentRequesterHandler` interfaces instead of custom oracle contracts.
- **Somnia RPC**: `shannon.sepolia.somnia.network` → `dream-rpc.somnia.network` (chain ID 50312).
- **Event listener**: WebSocket → HTTP polling (`getContractEvents` at 12s intervals) — dream-rpc does not support WS.
- **Config loading**: `config.ts` now uses lazy getters (`() => validateEnv()`) to ensure `dotenv.config()` runs before env validation.
- **MockAgentRequester**: Synchronous `IHandleResponse` callback instead of async — enables deterministic testing.
- **Agent fee deduction**: Moved to `invokeEvaluation()` (deducted from `j.amount` before platform call) so refunds always have correct available balance.
- **Domain allowlist**: Enforced in `submitWork` — `http://` accepted alongside `https://`, bare domains rejected.

### Fixed
- 3 EVAL-11 test failures: Root cause was `_decodeString(bytes calldata raw)` + `abi.decode(raw, (string))` failing due to ABI calldata layout mismatch in external calls via `this._decodeString()`. Changed to `_decodeString(bytes memory raw)` + `string(raw)` — a pure type cast that never reverts.
- `workspace:*` → `"*"` in root `package.json` (npm does not support `workspace:` protocol).
- Prisma pinned to `^5.22.0` (v7 CLI incompatible with `@prisma/client` v5 schema format).
- Removed unused `parseAbiItem` import, `formatEther` import, `withRetry` function, typechain directory.

### Removed
- `CompletionEvaluator.sol`, `DeliverableOracle.sol`, all old mock contracts (`MockOracle`, `MockEvaluator`, `MockLLMInference`, `MockEscrow`).
- `SOMNIA_WS_URL` from required env vars.
- Typechain generated code (`packages/types/typechain/`).

### Security
- `handleResponse` MUST NOT revert — all error branches refund, dispute, or return idempotently.
- Invoking `invokeEvaluation` on a job already in EVALUATING/COMPLETE/REFUNDED state reverts with `WrongStatus`.
- ReentrancyGuard on all fund-moving operations. Pausable for emergency stop.
- Deployer wallet rotated. Platform contract verified at `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776`.

### Deployment
- Contracts deployed to Somnia testnet:
  - `FlowFiEscrow: 0x1aB4A7DB253c7Ac1BB7A970bd69Dff728d09788e`
  - `FlowNFT: 0xc2597766E4209b4c356df6D2568ebd9cfF744092`
  - Deploy block: `398404163`
- Deployer wallet: `0xF639694848072E2d1fa77371707f33663B6eeA86` (funded with 100 STT)
- `render.yaml` updated for external Neon PostgreSQL + Upstash Redis.
- All packages build: contracts (Hardhat ✅), types (tsc ✅), API (tsc ✅), web (Next.js production ✅).

## [0.1.0] — 2026-05-27

### Added
- Monorepo scaffold with Turbo workspace (`apps/contracts`, `apps/api`, `apps/web`, `packages/types`)
- FlowFiEscrow.sol — full state machine with 6 states, CEI pattern, ReentrancyGuard, Pausable
  - `createJob` — client deposits payment, creates escrow
  - `submitWork` — freelancer submits deliverable URL
  - `invokeEvaluation` — triggers AI evaluation (callable by anyone)
  - `fulfillEvaluation` — score-based branching (≥80 release, 50-79 dispute, <50 refund)
  - `clientOverride` — client resolves disputed jobs
  - `claimRefundAfterTimeout` — escape hatch after deadline + 3 days
- FlowNFT.sol — on-chain ERC721 receipt with base64 metadata, single-use minter
- CompletionEvaluator.sol — Somnia LLMInference integration with JSON parser
- DeliverableOracle.sol — URL scraping agent with domain allowlist
- Mock contracts for all dependencies
- 32 unit tests (state machine, edge cases, reentrancy)
- ABI export pipeline
- Prisma schema for PostgreSQL mirror
- Render deployment blueprint
- Hardhat config with Somnia devnet (chain ID 50311)
