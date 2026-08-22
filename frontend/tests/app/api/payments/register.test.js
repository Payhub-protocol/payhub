import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/payments/register/route";
import store from "@/lib/server/store";

describe("POST /api/payments/register", () => {
  beforeEach(() => {
    store.payments = {};
    store.disputes = {};
    store.audits = {};
  });

  it("returns 400 if paymentId is missing", async () => {
    const req = new Request("http://localhost:3000/api/payments/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: "ord_1" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "paymentId required" });
  });

  it("stores payment metadata and returns ok with paymentId when paymentId is provided", async () => {
    const payload = {
      paymentId: "pay_abc",
      orderId: "ord_123",
      payer: "G_PAYER",
      merchant: "G_MERCHANT",
      amount: "100",
      token: "USDC",
    };

    const req = new Request("http://localhost:3000/api/payments/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, paymentId: "pay_abc" });
    expect(store.payments["pay_abc"]).toBeDefined();
    expect(store.payments["pay_abc"].orderId).toBe("ord_123");
    expect(store.payments["pay_abc"].registeredAt).toBeDefined();
  });

  it("returns 500 when JSON parsing fails", async () => {
    const req = {
      json: async () => {
        throw new Error("Invalid JSON body");
      },
    };

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "Invalid JSON body" });
  });
});
