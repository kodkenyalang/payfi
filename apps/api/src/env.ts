const REQUIRED = [
  "DATABASE_URL", "REDIS_URL", "SOMNIA_RPC_URL",
  "DEPLOYER_PRIVATE_KEY",
  "ESCROW_ADDRESS", "NFT_ADDRESS", "DEPLOY_BLOCK"
] as const;

export function validateEnv(): Record<string, string> {
  const missing = REQUIRED.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`FATAL: Missing required environment variables:\n  ${missing.join("\n  ")}`);
    process.exit(1);
  }
  return Object.fromEntries(
    REQUIRED.map(k => [k, process.env[k]!])
  );
}
