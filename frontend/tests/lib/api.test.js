import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "@/lib/api";

describe("lib/api.js", () => {
  const originalEnv = process.env;
  let mockFetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_API_URL;
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("request wrapper", () => {
    it("uses NEXT_PUBLIC_API_URL in Node environment when set", async () => {
      process.env.NEXT_PUBLIC_API_URL = "https://api.payhub.test";
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const res = await api.getPayment("pay_123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.payhub.test/api/payments/pay_123",
        expect.objectContaining({
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
        })
      );
      expect(res).toEqual({ success: true });
    });

    it("falls back to http://localhost:3000 in Node environment when NEXT_PUBLIC_API_URL is unset", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: "test" }),
      });

      const res = await api.getPayment("42");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/payments/42",
        expect.anything()
      );
      expect(res).toEqual({ data: "test" });
    });

    it("uses relative path when window is defined in browser environment", async () => {
      vi.stubGlobal("window", {});
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ inBrowser: true }),
      });

      const res = await api.getPayment("99");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/payments/99",
        expect.anything()
      );
      expect(res).toEqual({ inBrowser: true });
    });

    it("merges custom headers with default Content-Type header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      await api.registerPayment({ paymentId: "p1" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    it("throws error with json.error message when response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: "paymentId required" }),
      });

      await expect(api.registerPayment({})).rejects.toThrow("paymentId required");
    });

    it("throws error with status fallback when json.error is missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({}),
      });

      await expect(api.getPayment("1")).rejects.toThrow("Request failed: 502");
    });
  });

  describe("API endpoint helpers", () => {
    it("registerPayment sends POST to /api/payments/register with body", async () => {
      const payload = { paymentId: "pay_1", amount: "100", token: "USDC" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, paymentId: "pay_1" }),
      });

      const result = await api.registerPayment(payload);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/payments/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      expect(result).toEqual({ ok: true, paymentId: "pay_1" });
    });

    it("getPayment sends GET to /api/payments/:id", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ paymentId: "123", status: "SETTLED" }),
      });

      const result = await api.getPayment("123");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/payments/123",
        {
          headers: { "Content-Type": "application/json" },
        }
      );
      expect(result).toEqual({ paymentId: "123", status: "SETTLED" });
    });

    it("registerDispute sends POST to /api/payments/:id/dispute/register with body", async () => {
      const disputeBody = { reason: "Item not received", txHash: "0xabc" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      const result = await api.registerDispute("pay_dispute_1", disputeBody);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/payments/pay_dispute_1/dispute/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(disputeBody),
        }
      );
      expect(result).toEqual({ ok: true });
    });

    it("resolve sends POST to /api/payments/:id/resolve with body", async () => {
      const resolveBody = { inFavorOfPayer: true, verdict: "Payer provided evidence", authToken: "secret" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, txHash: "0x123" }),
      });

      const result = await api.resolve("pay_resolve_1", resolveBody);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/payments/pay_resolve_1/resolve",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(resolveBody),
        }
      );
      expect(result).toEqual({ ok: true, txHash: "0x123" });
    });

    it("autoResolve sends POST to /api/payments/:id/auto-resolve with empty body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, txHash: "0xauto" }),
      });

      const result = await api.autoResolve("pay_auto_1");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/payments/pay_auto_1/auto-resolve",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      expect(result).toEqual({ ok: true, txHash: "0xauto" });
    });

    it("getAudit sends GET to /api/payments/:id/audit", async () => {
      const auditData = { version: "1.0", payment: { id: "pay_aud_1" } };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => auditData,
      });

      const result = await api.getAudit("pay_aud_1");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/payments/pay_aud_1/audit",
        {
          headers: { "Content-Type": "application/json" },
        }
      );
      expect(result).toEqual(auditData);
    });
  });
});
