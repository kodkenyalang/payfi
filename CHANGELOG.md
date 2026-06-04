# Changelog

## [0.3.3] — 2026-06-04

### Fixed
- **Explorer link broken (tx hash not findable)**: All explorer URLs used `shannon.explorer.somnia.network` (dot) which does not resolve. The correct URL is `shannon-explorer.somnia.network` (hyphen). Transactions were landing on the correct testnet chain (RPC verified: chain ID 50312), but the explorer links in the UI were pointing to a non-resolving domain.

### Changed
- **Explorer URL** in `apps/web/src/lib/chains.ts`, `apps/api/src/lib/chains.ts`, and `apps/web/src/app/page.tsx`: `shannon.explorer.somnia.network` → `shannon-explorer.somnia.network`
- **Hardcoded explorer links** in `page.tsx:365` consolidated to use `SOMNIA_EXPLORER` constant

### Added
- **`network-guard.ts`** (`apps/web/src/lib/network-guard.ts`): Three Poka-Yoke guards for defense-in-depth:
  - `assertCorrectNetwork(provider)` — throws actionable error if provider chain ID !== 50312
  - `switchToSomniaTestnet()` — auto-switches MetaMask or prompts add-network via `wallet_switchEthereumChain` / `wallet_addEthereumChain`
  - `getTxExplorerUrl(txHash)` — returns correct testnet explorer URL for a transaction hash
- **`network-guard.test.ts`**: 11 unit tests covering chain assertion (50312 resolves, 5031/1/0 throws), network switch (switch + add flows, provider missing), and explorer URL generation (correct domain, no mainnet leak, full hash preservation)

## [0.3.2] — 2026-06-04

### Fixed
- **React hydration error #418 (ConnectWallet mismatch)**: Server rendered `<button>Connect Wallet</button>` but client hydrated with wallet address when `isConnected=true` from persisted wagmi state. Fixed with `isMounted` state guard — server emits stable height placeholder, client replaces after first render.
- **React hydration error #423 (window not defined)**: Components using `window.ethereum.setMaxListeners` crashed during SSR when Next.js server-side rendered before client JS loaded. Fixed by wrapping `ConnectWallet` and `CreateJobForm` in `<Suspense>` boundaries + per-component `isMounted` guards.
- **Amount display bug (300 STT instead of 3.0 STT)**: Line `BigInt(amountWei) / 10^16` used integer division 10^16 instead of 10^18, producing 300x inflated values. Fixed with `formatEther(BigInt(amountWei))` from viem.
- **EventEmitter listener leak on re-render**: `accountsChanged`/`chainChanged` handlers added on each render but never cleaned up. Changed no-op handlers to meaningful resets with proper `removeListener` in `useEffect` return.
- **Agent event trace invisible**: `Live Events` panel only showed unstructured strings. Added typed `StructuredEvent` interface with icon, label, detail, and clickable explorer links per event type. Each contract event now displays its tx hash linking to Somnia explorer.

### Added
- **`StructuredEvent` type**: `apps/web/src/app/page.tsx:64-72` — typed event interface with `id`, `time`, `icon`, `label`, `detail`, `txHash` fields for structured Live Events display.
- **`AgentEvent` type**: `apps/web/src/types/agent-events.ts` — typed union schema for 6 agent lifecycle events (`agent.invoked`, `agent.reasoning`, `agent.decision`, `agent.tx.submitted`, `agent.tx.confirmed`, `agent.tx.failed`).
- **`OnLogMeta` interface**: `apps/web/src/hooks/useJobEvents.ts:6-9` — captures `txHash` and `blockNumber` from raw event logs. Added `pick()` helper to extract args + meta from log array.
- **Transaction hash links**: Every `CreateJobForm` and `JobStatusCard` now shows clickable Somnia explorer links for each event's tx hash.
- **Button state machine error state**: `txState` now includes `"error"` state; button shows "Try Again" with red background on write/API failure, stays clickable for retry.
- **Agent trace visibility**: `onEvaluationRequested` displays 🤖 icon + agent request ID + tx hash link. `onEvaluationComplete` shows ✅/⚖️/❌ icon + score + reason + tx hash link.

### Changed
- **`useJobEvents` callbacks**: All 5 event callbacks now receive `meta: { txHash, blockNumber }` as the last parameter. Inline `logs.find(...)` logic refactored into shared `pick()` helper.
- **EventEmitter handlers**: `accountsChanged` now resets `createdJob` state on disconnect. `chainChanged` resets `createdJob` on network switch. Both handlers are properly cleaned up on unmount.
- **Amount display**: Manual `BigInt / 10^n` replaced with `formatEther()` from viem for correct decimal placement.
- **Diagram concurrency check**: Ran full trace of all 6 mermaid diagram edges against source code — all connections confirmed accurate. No diagram changes needed.

## [0.3.1] — 2026-06-04

### Fixed
- **BigInt serialization crash (O1)**: `res.json(PrismaBigInt)` in API was throwing "Do not know how to serialize a BigInt". Fixed with Express global `json replacer` (`app.set("json replacer", bigIntReplacer)`). Frontend fetch also uses `bigIntReplacer` defensively.
- **`wallet_requestPermissions` queue collision (O2)**: Rapid/clustered button clicks caused multiple concurrent MetaMask RPC calls. Fixed with `useRef` hard mutex guard + `useState` + `useEffect` reset on wagmi state changes.
- **EventEmitter listener leak (O3)**: 11+ `close`/`end` listeners accumulated across component re-renders, causing `MaxListenersExceededWarning` and ObjectMultiplex orphan streams. Fixed with `useEffect` cleanup for `accountsChanged`/`chainChanged` + `setMaxListeners(20)`.
- **UI success state on failure (O5)**: Button showed "Job Created!" before tx confirmed. Fixed with `txState` string union (`idle|pending|confirming|success`) that only transitions to success on confirmed receipt.
- **UseWriteContract sync error uncaught**: `handleCreate` now wraps `writeContract` + `BigInt()` in try/catch to reset mutex and surface errors on invalid input (e.g., empty deadline → `BigInt(NaN)`).

### Added
- **`bigIntReplacer` utility**: `apps/web/src/utils/bigint-serializer.ts` — JSON.stringify replacer that converts `bigint` → `string`.
- **`EvaluationRequested` event listener**: `useJobEvents` hook now watches `EvaluationRequested` (was emitted by contract but never consumed by frontend). Displays `EvaluationRequested: agentRequestId=...` in live event feed.
- **Chaos engineering tests**: 23 tests across 3 suites verifying BigInt range (`uint256 max`), submission mutex (1000 rounds × 5 concurrent), and EventEmitter cleanup (10,000 mount/unmount cycles with zero leaks).

### Changed
- **README diagrams reconciled with codebase**: Architecture diagram now shows `EW --> PM` (BullMQ worker writes via Prisma) and `JR --> RD` (job routes enqueue to Redis). Sequence diagram corrects `submitWork` detection attribution, un-conflates `EvaluationComplete` vs `PaymentReleased`, and uses proper event emission notation.

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
