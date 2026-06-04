import { defineChain } from "viem";

export const somniaTestnet = defineChain({
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_SOMNIA_RPC_URL || "https://dream-rpc.somnia.network"] }
  },
  blockExplorers: {
    default: { name: "Somnia Explorer", url: "https://shannon-explorer.somnia.network" }
  }
});
