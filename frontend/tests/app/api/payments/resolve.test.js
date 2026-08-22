import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import store from "@/lib/server/store";
import * as chainModule from "@/lib/server/chain";
import { POST } from "@/app/api/payments/[id]/resolve/route";

vi.mock("@/lib/server/chain", () => ({
  getPayment: vi.fn(),
  getDispute: vi.fn(),
  arbiterResolve: vi.fn(),
  autoResolveExpired: vi.fn(),
}));

describe("POST /api/payments/[id]/resolve", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ARBITER_AUTH_TOKEN: "valid_arbiter_token" };
    store.payments = {};
    store.disputes = {};
    store.audits = {};
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 401 Unauthorized if authToken does not match ARBITER_AUTH_TOKEN", async () => {
    const req = new Request("http://localhost:3000/api/payments/pay_1/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authToken: "wrong_token",
        inFavorOfPayer: true,
        verdict: "refund",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "pay_1" }) });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("returns 404 if payment is not found on-chain", async () => {
    vi.mocked(chainModule.getPayment).mockResolvedValueOnce(null);

    const req = new Request("http://localhost:3000/api/payments/pay_nonexistent/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authToken: "valid_arbiter_token",
        inFavorOfPayer: true,
        verdict: "refund",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "pay_nonexistent" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Payment not found" });
  });

  it("resolves dispute in favor of payer, generates audit bundle, stores it, and returns txHash and audit", async () => {
    vi.mocked(chainModule.getPayment).mockResolvedValueOnce({
      payer: "G_PAYER_123",
      merchant: "G_MERCH_456",
      amount: "1000000",
      token: "USDC",
      createdAt: "1755600000",
      order_id: "ord_onchain",
    });
    vi.mocked(chainModule.arbiterResolve).mockResolvedValueOnce({ txHash: "0xresolvetx123" });
    vi.mocked(chainModule.getDispute).mockResolvedValueOnce({
      reason: "Item counterfeit",
      opened_at: "1755601000",
      merchant_responded: true,
      merchant_evidence: "Certificate of authenticity",
    });

    store.payments["pay_resolve_ok"] = { orderId: "ord_override" };

    const req = new Request("http://localhost:3000/api/payments/pay_resolve_ok/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authToken: "valid_arbiter_token",
        inFavorOfPayer: true,
        verdict: "Evidence deemed insufficient, refunding buyer",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "pay_resolve_ok" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.txHash).toBe("0xresolvetx123");
    expect(chainModule.arbiterResolve).toHaveBeenCalledWith("pay_resolve_ok", true);

    expect(body.audit).toBeDefined();
    expect(body.audit.payment.status).toBe("REFUNDED");
    expect(body.audit.payment.orderId).toBe("ord_override");
    expect(body.audit.refund).toEqual({
      destination: "G_PAYER_123",
      note: "Refund issued to originating payer wallet only (refund-to-source).",
    });
    expect(body.audit.dispute.reason).toBe("Item counterfeit");
    expect(body.audit.resolution.verdict).toBe("Evidence deemed insufficient, refunding buyer");
    expect(body.audit.resolution.inFavorOfPayer).toBe(true);
    expect(body.audit.resolution.txHash).toBe("0xresolvetx123");

    expect(store.audits["pay_resolve_ok"]).toEqual(body.audit);
  });

  it("resolves dispute in favor of merchant (SETTLED) falling back to store dispute data", async () => {
    vi.mocked(chainModule.getPayment).mockResolvedValueOnce({
      payer: "G_PAYER_123",
      merchant: "G_MERCH_456",
      amount: "500000",
      token: "USDC",
      created_at: "1755600000",
      order_id: "ord_chain_id",
    });
    vi.mocked(chainModule.arbiterResolve).mockResolvedValueOnce({ txHash: "0xmerchantwin" });
    vi.mocked(chainModule.getDispute).mockRejectedValueOnce(new Error("RPC dispute error"));

    store.disputes["pay_merch_win"] = {
      reason: "Buyer claim rejected",
      openedAt: 1755601000,
      merchantResponded: true,
    };

    const req = new Request("http://localhost:3000/api/payments/pay_merch_win/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authToken: "valid_arbiter_token",
        inFavorOfPayer: false,
        verdict: "Merchant provided tracking confirmation",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "pay_merch_win" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.txHash).toBe("0xmerchantwin");
    expect(body.audit.payment.status).toBe("SETTLED");
    expect(body.audit.refund).toBeNull();
  });

  it("returns 500 when arbiterResolve throws an error", async () => {
    vi.mocked(chainModule.getPayment).mockResolvedValueOnce({
      payer: "G_PAYER_123",
      merchant: "G_MERCH_456",
      amount: "100",
      token: "USDC",
    });
    vi.mocked(chainModule.arbiterResolve).mockRejectedValueOnce(new Error("Transaction simulation failed"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const req = new Request("http://localhost:3000/api/payments/pay_fail/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authToken: "valid_arbiter_token",
        inFavorOfPayer: true,
        verdict: "refund",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "pay_fail" }) });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "Transaction simulation failed" });

    consoleSpy.mockRestore();
  });
});
