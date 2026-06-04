export const REQUIRED_CHAIN_ID = 50312;
export const REQUIRED_RPC_URL = "https://dream-rpc.somnia.network";
export const EXPLORER_URL = "https://shannon-explorer.somnia.network";

export async function assertCorrectNetwork(provider: { getNetwork: () => Promise<{ chainId: bigint }> }): Promise<void> {
  const network = await provider.getNetwork();
  const actual = Number(network.chainId);
  if (actual !== REQUIRED_CHAIN_ID) {
    throw new Error(
      `Wrong network. Expected Somnia Testnet (chainId ${REQUIRED_CHAIN_ID}), ` +
      `got chainId ${actual}. Please switch MetaMask to Somnia Testnet.`
    );
  }
}

export async function switchToSomniaTestnet(): Promise<void> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No ethereum provider found");
  }
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xc488" }],
    });
  } catch (switchError: unknown) {
    const err = switchError as { code: number };
    if (err.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0xc488",
          chainName: "Somnia Testnet",
          nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
          rpcUrls: ["https://dream-rpc.somnia.network"],
          blockExplorerUrls: ["https://shannon-explorer.somnia.network/"],
        }],
      });
    } else {
      throw switchError;
    }
  }
}

export const getTxExplorerUrl = (txHash: string): string =>
  `https://shannon-explorer.somnia.network/tx/${txHash}`;
