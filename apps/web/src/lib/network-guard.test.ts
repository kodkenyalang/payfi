import { assertCorrectNetwork, switchToSomniaTestnet, getTxExplorerUrl, REQUIRED_CHAIN_ID } from "./network-guard";

beforeEach(() => {
  (window as any).ethereum = {
    request: jest.fn().mockResolvedValue(null),
  };
});

afterEach(() => {
  delete (window as any).ethereum;
});

describe("assertCorrectNetwork", () => {
  it("resolves when chainId is testnet (50312)", async () => {
    const mockProvider = {
      getNetwork: jest.fn().mockResolvedValue({ chainId: 50312n }),
    };
    await expect(assertCorrectNetwork(mockProvider)).resolves.toBeUndefined();
  });

  it("throws when chainId is mainnet (5031)", async () => {
    const mockProvider = {
      getNetwork: jest.fn().mockResolvedValue({ chainId: 5031n }),
    };
    await expect(assertCorrectNetwork(mockProvider)).rejects.toThrow("Wrong network");
  });

  it("throws when chainId is any unrecognised chain", async () => {
    const mockProvider = {
      getNetwork: jest.fn().mockResolvedValue({ chainId: 1n }),
    };
    await expect(assertCorrectNetwork(mockProvider)).rejects.toThrow(String(REQUIRED_CHAIN_ID));
  });

  it("throws when chainId is 0n (no chain)", async () => {
    const mockProvider = {
      getNetwork: jest.fn().mockResolvedValue({ chainId: 0n }),
    };
    await expect(assertCorrectNetwork(mockProvider)).rejects.toThrow("Wrong network");
  });
});

describe("switchToSomniaTestnet", () => {
  it("calls wallet_switchEthereumChain with correct chainId", async () => {
    const mockRequest = jest.fn().mockResolvedValue(null);
    (window as any).ethereum = { request: mockRequest };

    await switchToSomniaTestnet();

    expect(mockRequest).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xc488" }],
    });
  });

  it("calls wallet_addEthereumChain when chain not found (error code 4902)", async () => {
    const mockRequest = jest.fn()
      .mockRejectedValueOnce({ code: 4902 })
      .mockResolvedValueOnce(null);
    (window as any).ethereum = { request: mockRequest };

    await switchToSomniaTestnet();

    expect(mockRequest).toHaveBeenCalledTimes(2);
    const addCall = mockRequest.mock.calls[1][0];
    expect(addCall.method).toBe("wallet_addEthereumChain");
    expect(addCall.params[0].chainId).toBe("0xc488");
    expect(addCall.params[0].rpcUrls).toContain("https://dream-rpc.somnia.network");
    expect(addCall.params[0].blockExplorerUrls).toContain("https://shannon-explorer.somnia.network/");
  });

  it("throws on non-4902 switch errors", async () => {
    const mockRequest = jest.fn().mockRejectedValue({ code: 4001 });
    (window as any).ethereum = { request: mockRequest };

    await expect(switchToSomniaTestnet()).rejects.toEqual({ code: 4001 });
  });

  it("throws when ethereum provider is missing", async () => {
    delete (window as any).ethereum;
    await expect(switchToSomniaTestnet()).rejects.toThrow("No ethereum provider found");
  });
});

describe("getTxExplorerUrl", () => {
  it("generates correct testnet explorer URL", () => {
    const hash = "0x85a4e92e1234567890abcdef1234567890abcdef1234567890abcdef4cd7fb00";
    expect(getTxExplorerUrl(hash))
      .toBe(`https://shannon-explorer.somnia.network/tx/${hash}`);
  });

  it("never generates a mainnet explorer URL", () => {
    const url = getTxExplorerUrl("0xabc");
    expect(url).not.toContain("explorer.somnia.network/tx");
    expect(url).toContain("shannon-explorer.somnia.network");
  });

  it("truncates nothing — returns full hash", () => {
    const hash = "0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678";
    const url = getTxExplorerUrl(hash);
    expect(url).toContain(hash);
    expect(url.split("/tx/")[1]).toBe(hash);
  });
});
