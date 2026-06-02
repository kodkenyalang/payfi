# Changelog

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
