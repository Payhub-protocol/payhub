const { expect } = require("chai");
const { ethers }  = require("hardhat");
const { time }    = require("@nomicfoundation/hardhat-network-helpers");

describe("PayHub", () => {
  let payhub, token;
  let owner, arbiter, payer, merchant, feeRecipient;
  const AMOUNT = ethers.parseUnits("100", 6);
  const APASS_PAYER     = "apass_payer_001";
  const APASS_MERCHANT  = "apass_merchant_001";

  beforeEach(async () => {
    [owner, arbiter, payer, merchant, feeRecipient] = await ethers.getSigners();

    // Deploy a mock ERC-20 as A-Token stand-in
    const ERC20 = await ethers.getContractFactory("MockERC20");
    token = await ERC20.deploy("Mock AToken", "mATOK", 6);
    await token.mint(payer.address, ethers.parseUnits("10000", 6));

    const PayHub = await ethers.getContractFactory("PayHub");
    payhub = await PayHub.deploy(arbiter.address, feeRecipient.address);

    // Payer approves escrow
    await token.connect(payer).approve(await payhub.getAddress(), ethers.MaxUint256);
  });

  async function initPayment(finality = 0) {
    const tx = await payhub.connect(payer).initiatePayment(
      merchant.address, await token.getAddress(), AMOUNT,
      "order_001", APASS_PAYER, APASS_MERCHANT, finality
    );
    const receipt = await tx.wait();
    const event = receipt.logs.map(l => { try { return payhub.interface.parseLog(l); } catch { return null; }}).find(e => e?.name === "PaymentInitiated");
    return event.args.paymentId;
  }

  // ── Happy path ─────────────────────────────────────────────────────────────

  it("initiates payment and holds funds", async () => {
    const id = await initPayment();
    const p = await payhub.getPayment(id);
    expect(p.status).to.equal(0); // PENDING
    expect(p.payer).to.equal(payer.address);
    expect(await token.balanceOf(await payhub.getAddress())).to.equal(AMOUNT);
  });

  it("merchant claims after finality window", async () => {
    const id = await initPayment(60);
    await time.increase(61);
    const before = await token.balanceOf(merchant.address);
    await payhub.connect(merchant).claimPayment(id);
    const after = await token.balanceOf(merchant.address);
    expect(after - before).to.be.gt(0n);
    expect((await payhub.getPayment(id)).status).to.equal(1); // SETTLED
  });

  // ── Dispute path ───────────────────────────────────────────────────────────

  it("payer opens dispute and auto-refund fires on merchant no-show", async () => {
    const id = await initPayment(3 * 24 * 3600);
    await payhub.connect(payer).openDispute(id, "Product not delivered");
    const d = await payhub.getDispute(id);
    expect(d.openedAt).to.be.gt(0n);

    await time.increase(25 * 3600); // past merchant response window
    const before = await token.balanceOf(payer.address);
    await payhub.autoResolveExpiredDispute(id);
    const after = await token.balanceOf(payer.address);
    expect(after - before).to.equal(AMOUNT);
    expect((await payhub.getPayment(id)).status).to.equal(3); // REFUNDED
  });

  it("arbiter resolves dispute in payer's favour", async () => {
    const id = await initPayment(3 * 24 * 3600);
    await payhub.connect(payer).openDispute(id, "Fraud");
    const before = await token.balanceOf(payer.address);
    await payhub.connect(arbiter).resolveDispute(id, true, "Fraud confirmed");
    expect(await token.balanceOf(payer.address) - before).to.equal(AMOUNT);
  });

  it("arbiter resolves dispute in merchant's favour", async () => {
    const id = await initPayment(3 * 24 * 3600);
    await payhub.connect(payer).openDispute(id, "Buyer's remorse");
    await payhub.connect(merchant).respondToDispute(id, "ipfs://proof");
    const before = await token.balanceOf(merchant.address);
    await payhub.connect(arbiter).resolveDispute(id, false, "Merchant proved delivery");
    expect(await token.balanceOf(merchant.address) - before).to.be.gt(0n);
  });

  // ── Access controls ────────────────────────────────────────────────────────

  it("rejects dispute from non-payer", async () => {
    const id = await initPayment(3 * 24 * 3600);
    await expect(payhub.connect(merchant).openDispute(id, "test"))
      .to.be.revertedWith("Only payer can dispute");
  });

  it("rejects claim before finality window", async () => {
    const id = await initPayment(3 * 24 * 3600);
    await expect(payhub.connect(merchant).claimPayment(id))
      .to.be.revertedWith("Finality window active");
  });

  it("rejects non-arbiter resolution", async () => {
    const id = await initPayment(3 * 24 * 3600);
    await payhub.connect(payer).openDispute(id, "test");
    await expect(payhub.connect(payer).resolveDispute(id, true, "bad"))
      .to.be.revertedWith("Not arbiter");
  });
});
