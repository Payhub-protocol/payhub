import { describe, it, expect, vi, beforeEach } from "vitest";
import store from "@/lib/server/store";
import * as chainModule from "@/lib/server/chain";
import { GET } from "@/app/api/payments/[id]/route";

vi.mock("@/lib/server/chain", () => ({
  getPayment: vi.fn(),
  getDispute: vi.fn(),
  arbiterResolve: vi.fn(),
  autoResolveExpired: vi.fn(),
}));

describe("GET /api/payments/[id]", () => {
  beforeEach(() => {
    store.payments = {};
    store.disputes = {};
    store.audits = {};
    vi.clearAllMocks();
  });

  it("returns 404 when neither on-chain nor store data exists", async () => {
    vi.mocked(chainModule.getPayment).mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost:3000/api/payments/999"), {
      params: Promise.resolve({ id: "999" }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Payment not found" });
    expect(chainModule.getPayment).toHaveBeenCalledWith("999");
  });

  it("returns payment data when found only on-chain", async () => {
    vi.mocked(chainModule.getPayment).mockResolvedValueOnce({
      payer: "G_PAYER_CHAIN",
      merchant: "G_MERCH_CHAIN",
      amount: 1000000n,
      status: "Settled",
      created_at: 1755600000n,
    });

    const res = await GET(new Request("http://localhost:3000/api/payments/1"), {
      params: Promise.resolve({ id: "1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      paymentId: "1",
      onChain: {
        payer: "G_PAYER_CHAIN",
        merchant: "G_MERCH_CHAIN",
        amount: "1000000",
        status: "SETTLED",
        createdAt: "1755600000",
      },
    });
  });

  it("returns payment data when found only in store metadata", async () => {
    vi.mocked(chainModule.getPayment).mockRejectedValueOnce(new Error("RPC timeout"));
    store.payments["2"] = {
      orderId: "ord_stored",
      payer: "G_STORE_PAYER",
      amount: "50",
    };

    const res = await GET(new Request("http://localhost:3000/api/payments/2"), {
      params: Promise.resolve({ id: "2" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      paymentId: "2",
      orderId: "ord_stored",
      payer: "G_STORE_PAYER",
      amount: "50",
      onChain: null,
    });
  });

  it("returns merged data when found in both on-chain and store", async () => {
    store.payments["3"] = {
      orderId: "ord_merged",
      token: "USDC",
    };
    vi.mocked(chainModule.getPayment).mockResolvedValueOnce({
      payer: "G_MERGED_PAYER",
      merchant: "G_MERGED_MERCHANT",
      amount: "2000000",
      status: "Pending",
      createdAt: "1755605000",
    });

    const res = await GET(new Request("http://localhost:3000/api/payments/3"), {
      params: Promise.resolve({ id: "3" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      paymentId: "3",
      orderId: "ord_merged",
      token: "USDC",
      onChain: {
        payer: "G_MERGED_PAYER",
        merchant: "G_MERGED_MERCHANT",
        amount: "2000000",
        status: "PENDING",
        createdAt: "1755605000",
      },
    });
  });

  it("returns 500 if an unexpected error occurs", async () => {
    const res = await GET(new Request("http://localhost:3000/api/payments/err"), {
      params: Promise.reject(new Error("Param extraction failed")),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "Param extraction failed" });
  });
});
