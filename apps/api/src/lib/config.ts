import { validateEnv } from "../env";

let _env: Record<string, string> | null = null;
function env(): Record<string, string> {
  if (!_env) _env = validateEnv();
  return _env;
}

export const REDIS_URL = () => env().REDIS_URL;
export const ESCROW_ADDRESS = () => env().ESCROW_ADDRESS as `0x${string}`;
export const DEPLOY_BLOCK = () => BigInt(env().DEPLOY_BLOCK);
