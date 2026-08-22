import { describe, it, expect, vi, beforeEach } from "vitest";
import * as chainModule from "@/lib/server/chain";
import { POST } from "@/app/api/payments/[id]/auto-resolve/route";

vi.mock("@/lib/server/chain", () => ({
  getPayment: vi.fn(),
  getDispute: vi.fn(),
  arbiterResolve: vi.fn(),
  autoResolveExpired: vi.fn(),
}));

describe("POST /api/payments/[id]/auto-resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls autoResolveExpired and returns ok with txHash on success", async () => {
    vi.mocked(chainModule.autoResolveExpired).mockResolvedValueOnce({
      txHash: "0xautoresolvetx999",
    });

    const req = new Request("http://localhost:3000/api/payments/pay_expired_1/auto-resolve", {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "pay_expired_1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, txHash: "0xautoresolvetx999" });
    expect(chainModule.autoResolveExpired).toHaveBeenCalledWith("pay_expired_1");
  });

  it("returns 500 when autoResolveExpired fails", async () => {
    vi.mocked(chainModule.autoResolveExpired).mockRejectedValueOnce(
      new Error("Dispute is not yet expired")
    );

    const req = new Request("http://localhost:3000/api/payments/pay_not_expired/auto-resolve", {
      method: "POST",
    });

    const res = await POST(req, { params: Promise.resolve({ id: "pay_not_expired" }) });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "Dispute is not yet expired" });
  });
});
