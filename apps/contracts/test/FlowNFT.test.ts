import { expect } from "chai";
import { ethers } from "hardhat";

describe("FlowNFT", () => {
  async function deploy() {
    const [owner, minter, freelancer, other] = await ethers.getSigners();
    const FlowNFT = await ethers.getContractFactory("FlowNFT");
    const nft = await FlowNFT.deploy();
    return { nft, owner, minter, freelancer, other };
  }

  describe("setMinter", () => {
    it("allows owner to set minter once", async () => {
      const { nft, minter } = await deploy();
      await nft.setMinter(minter.address);
      expect(await nft.minter()).to.equal(minter.address);
    });

    it("reverts if minter set twice", async () => {
      const { nft, minter, other } = await deploy();
      await nft.setMinter(minter.address);
      await expect(nft.setMinter(other.address))
        .to.be.revertedWithCustomError(nft, "MinterAlreadySet");
    });

    it("reverts on zero address", async () => {
      const { nft } = await deploy();
      await expect(nft.setMinter(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(nft, "ZeroAddress");
    });

    it("reverts if called by non-owner", async () => {
      const { nft, minter, other } = await deploy();
      await expect(nft.connect(other).setMinter(minter.address))
        .to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
    });
  });

  describe("mintReceipt", () => {
    it("mints to freelancer, emits event, stores receipt data", async () => {
      const { nft, minter, freelancer } = await deploy();
      await nft.setMinter(minter.address);
      const tx = await nft.connect(minter).mintReceipt(freelancer.address, 42n, 85n);
      await expect(tx)
        .to.emit(nft, "ReceiptMinted")
        .withArgs(0, 42, freelancer.address);
      expect(await nft.ownerOf(0)).to.equal(freelancer.address);
      const receipt = await nft.receipts(0);
      expect(receipt.score).to.equal(85n);
    });

    it("reverts if called by non-minter", async () => {
      const { nft, minter, freelancer, other } = await deploy();
      await nft.setMinter(minter.address);
      await expect(nft.connect(other).mintReceipt(freelancer.address, 1n, 90n))
        .to.be.revertedWithCustomError(nft, "OnlyMinter");
    });

    it("reverts if to address is zero", async () => {
      const { nft, minter } = await deploy();
      await nft.setMinter(minter.address);
      await expect(nft.connect(minter).mintReceipt(ethers.ZeroAddress, 1n, 90n))
        .to.be.revertedWithCustomError(nft, "ZeroAddress");
    });
  });

  describe("tokenURI", () => {
    it("returns valid base64-encoded JSON", async () => {
      const { nft, minter, freelancer } = await deploy();
      await nft.setMinter(minter.address);
      await nft.connect(minter).mintReceipt(freelancer.address, 5n, 95n);
      const uri = await nft.tokenURI(0);
      expect(uri.startsWith("data:application/json;base64,")).to.be.true;
      const decoded = Buffer.from(uri.split(",")[1], "base64").toString();
      const parsed = JSON.parse(decoded);
      const jobAttr = parsed.attributes.find((a: any) => a.trait_type === "Job ID");
      expect(jobAttr.value).to.equal(5);
    });
  });
});
