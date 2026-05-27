# Changelog

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
- CompletionEvaluator.sol — Somnia LLMInference integration with JSON parser, never reverts on malformed input
- DeliverableOracle.sol — URL scraping agent with domain allowlist, Somnia LLMParseWebsite integration
- Mock contracts for all dependencies (MockOracle, MockEvaluator, MockLLMInference, MockEscrow, MaliciousFreelancer)
- 32 unit tests covering full state machine, edge cases, and reentrancy protection
- ABI export pipeline (`export-abis` Hardhat task)
- Stage 1 and Stage 2 deploy scripts with cross-contract permission setup
- Prisma schema for PostgreSQL mirror of on-chain state
- Render deployment blueprint (`render.yaml`)
- Environment variable inventory and `.env.example` templates
- Hardhat config with Somnia devnet (chain ID 50311) and local hardhat network
- `@openzeppelin/contracts` pinned to `5.0.2` exactly
