import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { buildAuditBundle } from "@/lib/server/audit";

describe("lib/server/audit.js - buildAuditBundle", () => {
  const fixedTime = new Date("2026-08-20T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedTime);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("builds a complete audit bundle with correct structure for a settled payment without dispute", () => {
    const input = {
      paymentId: "pay_100",
      orderId: "ord_200",
      payer: "G_PAYER_123",
      merchant: "G_MERCHANT_456",
      amount: 50000000,
      token: "USDC",
      status: "SETTLED",
      createdAt: 1755600000,
      dispute: null,
      resolution: null,
    };

    const bundle = buildAuditBundle(input);

    expect(bundle.version).toBe("1.0");
    expect(bundle.generated).toBe("2026-08-20T12:00:00.000Z");
    expect(bundle.payment).toEqual({
      id: "pay_100",
      orderId: "ord_200",
      payer: "G_PAYER_123",
      merchant: "G_MERCHANT_456",
      amount: "50000000",
      token: "USDC",
      status: "SETTLED",
      createdAt: new Date(1755600000 * 1000).toISOString(),
    });
    expect(bundle.dispute).toBeNull();
    expect(bundle.resolution).toBeNull();
    expect(bundle.refund).toBeNull();
    expect(typeof bundle.signature).toBe("string");
    expect(bundle.signature).toHaveLength(64); // SHA-256 hex
  });

  it("includes refund details when payment status is REFUNDED", () => {
    const input = {
      paymentId: "pay_refund_1",
      orderId: "ord_refund_1",
      payer: "G_PAYER_REFUND",
      merchant: "G_MERCHANT",
      amount: "100",
      token: "XLM",
      status: "REFUNDED",
      createdAt: 1755600000,
      dispute: null,
      resolution: { verdict: "Refunded to payer", inFavorOfPayer: true },
    };

    const bundle = buildAuditBundle(input);

    expect(bundle.refund).toEqual({
      destination: "G_PAYER_REFUND",
      note: "Refund issued to originating payer wallet only (refund-to-source).",
    });
    expect(bundle.resolution).toEqual({
      verdict: "Refunded to payer",
      inFavorOfPayer: true,
    });
  });

  it("correctly maps dispute fields with camelCase properties", () => {
    const input = {
      paymentId: "pay_disp_1",
      orderId: "ord_1",
      payer: "G_PAYER",
      merchant: "G_MERCH",
      amount: 10,
      token: "USDC",
      status: "DISPUTED",
      createdAt: 1755600000,
      dispute: {
        reason: "Item defective",
        openedAt: 1755601000,
        merchantResponded: true,
        merchantEvidence: "Tracking number delivered",
      },
      resolution: null,
    };

    const bundle = buildAuditBundle(input);

    expect(bundle.dispute).toEqual({
      reason: "Item defective",
      openedAt: new Date(1755601000 * 1000).toISOString(),
      merchantResponded: true,
      merchantEvidence: "Tracking number delivered",
    });
  });

  it("correctly handles dispute fallback snake_case properties and missing openedAt", () => {
    const input = {
      paymentId: "pay_disp_2",
      orderId: "ord_2",
      payer: "G_PAYER",
      merchant: "G_MERCH",
      amount: "20",
      token: "USDC",
      status: "DISPUTED",
      createdAt: 1755600000,
      dispute: {
        reason: "Not received",
        openedAt: null,
        merchant_responded: true,
        merchant_evidence: "Proof of postage",
      },
    };

    const bundle = buildAuditBundle(input);

    expect(bundle.dispute).toEqual({
      reason: "Not received",
      openedAt: null,
      merchantResponded: true,
      merchantEvidence: "Proof of postage",
    });
  });

  it("defaults merchantResponded to false and merchantEvidence to null when omitted", () => {
    const input = {
      paymentId: "pay_disp_3",
      orderId: "ord_3",
      payer: "G_PAYER",
      merchant: "G_MERCH",
      amount: "30",
      token: "USDC",
      status: "DISPUTED",
      createdAt: 1755600000,
      dispute: {
        reason: "Unauthorized charge",
      },
    };

    const bundle = buildAuditBundle(input);

    expect(bundle.dispute).toEqual({
      reason: "Unauthorized charge",
      openedAt: null,
      merchantResponded: false,
      merchantEvidence: null,
    });
  });

  it("computes deterministic HMAC signature matching expected calculation", () => {
    const input = {
      paymentId: "pay_sig_test",
      orderId: "ord_sig",
      payer: "G_PAYER",
      merchant: "G_MERCH",
      amount: "50",
      token: "USDC",
      status: "SETTLED",
      createdAt: 1755600000,
      dispute: null,
      resolution: null,
    };

    const bundle = buildAuditBundle(input);

    // Reconstruct canonical representation exactly as the function does
    const unsignedBundle = {
      version: bundle.version,
      generated: bundle.generated,
      payment: bundle.payment,
      dispute: bundle.dispute,
      resolution: bundle.resolution,
      refund: bundle.refund,
    };
    const canonical = JSON.stringify(unsignedBundle, Object.keys(unsignedBundle).sort());
    const expectedSecret = process.env.AUDIT_SIGNING_SECRET || "payhub_audit_secret_change_me";
    const expectedSignature = crypto.createHmac("sha256", expectedSecret).update(canonical).digest("hex");

    expect(bundle.signature).toBe(expectedSignature);
  });
});
