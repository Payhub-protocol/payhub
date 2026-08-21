export const runtime = "nodejs";
import store from "@/lib/server/store";
import { getPayment, getDispute, arbiterResolve } from "@/lib/server/chain";
import { buildAuditBundle } from "@/lib/server/audit";

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const { inFavorOfPayer, verdict, authToken } = await request.json();
    if (authToken !== process.env.ARBITER_AUTH_TOKEN)
      return Response.json({ error: "Unauthorized" }, { status: 401 });

    const onChain = await getPayment(id).catch(() => null);
    if (!onChain) return Response.json({ error: "Payment not found" }, { status: 404 });

    const result  = await arbiterResolve(id, inFavorOfPayer);
    const meta    = store.payments[id] || {};
    const dispute = await getDispute(id).catch(() => null);

    const disputeData = dispute || store.disputes[id] || null;
    const audit = buildAuditBundle({
      paymentId:  id,
      orderId:    meta.orderId  || onChain.order_id,
      payer:      onChain.payer,
      merchant:   onChain.merchant,
      amount:     onChain.amount?.toString() ?? onChain.amount,
      token:      onChain.token,
      status:     inFavorOfPayer ? "REFUNDED" : "SETTLED",
      createdAt:  onChain.created_at?.toString() ?? onChain.createdAt,
      dispute:    disputeData ? {
        ...disputeData,
        openedAt:         disputeData.opened_at?.toString()         ?? disputeData.openedAt,
        responseDeadline: disputeData.response_deadline?.toString() ?? disputeData.responseDeadline,
      } : null,
      resolution: { verdict, inFavorOfPayer, txHash: result.txHash, resolvedAt: new Date().toISOString() },
    });
    store.audits[id] = audit;

    return Response.json({ ok: true, txHash: result.txHash, audit });
  } catch (e) {
    console.error("[resolve]", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
