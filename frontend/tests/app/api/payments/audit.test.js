import { describe, it, expect, beforeEach } from "vitest";
import store from "@/lib/server/store";
import { GET } from "@/app/api/payments/[id]/audit/route";

describe("GET /api/payments/[id]/audit", () => {
  beforeEach(() => {
    store.payments = {};
    store.disputes = {};
    store.audits = {};
  });

  it("returns 404 if audit bundle does not exist in store", async () => {
    const res = await GET(new Request("http://localhost:3000/api/payments/pay_no_audit/audit"), {
      params: Promise.resolve({ id: "pay_no_audit" }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Audit bundle not yet generated" });
  });

  it("returns the stored audit bundle when present", async () => {
    const mockAudit = {
      version: "1.0",
      generated: "2026-08-20T12:00:00.000Z",
      payment: {
        id: "pay_has_audit",
        status: "SETTLED",
      },
      signature: "0x1234567890abcdef",
    };
    store.audits["pay_has_audit"] = mockAudit;

    const res = await GET(new Request("http://localhost:3000/api/payments/pay_has_audit/audit"), {
      params: Promise.resolve({ id: "pay_has_audit" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(mockAudit);
  });
});
