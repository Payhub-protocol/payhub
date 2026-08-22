import { describe, it, expect, beforeEach } from "vitest";
import store from "@/lib/server/store";
import { POST } from "@/app/api/payments/[id]/dispute/register/route";

describe("POST /api/payments/[id]/dispute/register", () => {
  beforeEach(() => {
    store.payments = {};
    store.disputes = {};
    store.audits = {};
  });

  it("stores dispute record and returns ok", async () => {
    const req = new Request("http://localhost:3000/api/payments/pay_123/dispute/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "Item arrived damaged",
        txHash: "0xdisputehash123",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "pay_123" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(store.disputes["pay_123"]).toBeDefined();
    expect(store.disputes["pay_123"].reason).toBe("Item arrived damaged");
    expect(store.disputes["pay_123"].txHash).toBe("0xdisputehash123");
    expect(store.disputes["pay_123"].openedAt).toBeDefined();
  });

  it("returns 500 when parsing fails or request is malformed", async () => {
    const badReq = {
      json: async () => {
        throw new Error("Invalid dispute body");
      },
    };

    const res = await POST(badReq, { params: Promise.resolve({ id: "pay_bad" }) });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "Invalid dispute body" });
  });
});
