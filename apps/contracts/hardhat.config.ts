import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const SOMNIA_RPC_URL = process.env.SOMNIA_RPC_URL;
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

if (!SOMNIA_RPC_URL) throw new Error("SOMNIA_RPC_URL is not set in .env");
if (!DEPLOYER_PRIVATE_KEY) throw new Error("DEPLOYER_PRIVATE_KEY is not set in .env");

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: false
    }
  },
  networks: {
    somnia_devnet: {
      url: SOMNIA_RPC_URL,
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 50311,
      timeout: 60000,
      httpHeaders: {}
    },
    hardhat: {
      chainId: 31337
    }
  },
  typechain: {
    outDir: "../../packages/types/typechain",
    target: "ethers-v6"
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    artifacts: "./artifacts"
  }
};

export default config;
