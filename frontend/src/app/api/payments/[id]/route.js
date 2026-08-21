export const runtime = "nodejs";
import store from "@/lib/server/store";
import { getPayment } from "@/lib/server/chain";

// The contract's Status enum comes back from scValToNative as its variant
// name ("Pending", "Settled", ...), not a numeric index.
function statusOf(onChain) {
  return String(onChain.status ?? "UNKNOWN").toUpperCase();
}

export async function GET(_req, { params }) {
  try {
    const { id } = await params;
    const [onChain, meta] = await Promise.all([
      getPayment(id).catch(() => null),
      Promise.resolve(store.payments[id] || null),
    ]);
    if (!onChain && !meta) return Response.json({ error: "Payment not found" }, { status: 404 });
    return Response.json({
      paymentId: id,
      ...(meta || {}),
      onChain: onChain ? {
        payer:    onChain.payer,
        merchant: onChain.merchant,
        amount:   onChain.amount?.toString(),
        status:   statusOf(onChain),
        createdAt: onChain.created_at?.toString() ?? onChain.createdAt?.toString(),
      } : null,
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
