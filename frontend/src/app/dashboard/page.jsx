"use client";
import { useState } from "react";
import { connectWallet } from "../../lib/wallet";
import { api } from "../../lib/api";
import Link from "next/link";

// Soroban amounts are raw i128 stroops (7 decimals for most Stellar assets).
function formatAmount(raw) {
  if (raw == null) return "—";
  const n = BigInt(raw);
  const whole = n / 10_000_000n;
  const frac = (n % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

const AMBER  = "#E8A020";
const INK    = "#0D1117";
const MUTED  = "#5B6470";
const BORDER = "#E8E7E2";
const CREAM  = "#FAF9F6";
const GREEN  = { text:"#1B7A4B", bg:"#E9F7EF", border:"#BBE5CF" };
const RED    = { text:"#B91C1C", bg:"#FEF2F2", border:"#FECACA" };
const BLUE   = { text:"#1D4ED8", bg:"#EFF6FF", border:"#BFDBFE" };

function Spinner({ size = 15 }) {
  return <div style={{ width:size,height:size,border:`2px solid ${AMBER}44`,borderTopColor:AMBER,borderRadius:"50%",flexShrink:0,animation:"phspin .6s linear infinite" }} />;
}

function Row({ label, value }) {
  return (
    <div style={{ display:"flex",justifyContent:"space-between",gap:16,padding:"9px 0",borderBottom:`1px solid #F5F4F0`,fontSize:13.5 }}>
      <span style={{ color:MUTED,fontWeight:500,flexShrink:0 }}>{label}</span>
      <span style={{ color:INK,fontWeight:600,textAlign:"right",wordBreak:"break-all" }}>{String(value ?? "—")}</span>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    PENDING:  { color:"#92400E", bg:"#FEF3C7", border:"#FDE68A" },
    SETTLED:  { color:GREEN.text, bg:GREEN.bg, border:GREEN.border },
    DISPUTED: { color:RED.text,   bg:RED.bg,   border:RED.border   },
    REFUNDED: { color:BLUE.text,  bg:BLUE.bg,  border:BLUE.border  },
  };
  const s = map[status] || { color:MUTED, bg:CREAM, border:BORDER };
  return (
    <span style={{ fontSize:12,fontWeight:700,padding:"4px 10px",borderRadius:100,color:s.color,background:s.bg,border:`1px solid ${s.border}` }}>
      {status || "UNKNOWN"}
    </span>
  );
}

export default function DashboardPage() {
  const [wallet,   setWallet]   = useState(null);
  const [walletBusy,setWalletBusy] = useState(false);
  const [lookup,   setLookup]   = useState("");
  const [payment,  setPayment]  = useState(null);
  const [audit,    setAudit]    = useState(null);
  const [fetching, setFetching] = useState(false);
  const [error,    setError]    = useState(null);

  async function connectClick() {
    setWalletBusy(true);
    try {
      const w = await connectWallet();
      setWallet(w);
    } catch (e) { setError(e.message); } finally { setWalletBusy(false); }
  }

  async function lookupPayment() {
    if (!lookup.trim()) return;
    setFetching(true); setError(null); setPayment(null); setAudit(null);
    try {
      const p = await api.getPayment(lookup.trim());
      setPayment(p);
      try { setAudit(await api.getAudit(lookup.trim())); } catch {}
    } catch (e) { setError(e.message); } finally { setFetching(false); }
  }

  async function triggerAutoResolve() {
    if (!payment) return;
    setFetching(true);
    try { await api.autoResolve(payment.paymentId); await lookupPayment(); }
    catch (e) { setError(e.message); } finally { setFetching(false); }
  }

  const status = payment?.onChain?.status;
  const amount = payment?.onChain?.amount ? formatAmount(payment.onChain.amount) : "—";

  return (
    <>
      <div style={{ background:"#fff",color:INK,minHeight:"100vh",fontFamily:"'Space Grotesk',system-ui,sans-serif" }}>
        {/* NAV */}
        <nav style={{ position:"sticky",top:0,zIndex:100,background:"rgba(255,255,255,.92)",backdropFilter:"saturate(180%) blur(14px)",borderBottom:`1px solid ${BORDER}` }}>
          <div style={{ maxWidth:900,margin:"0 auto",padding:"0 24px",height:64,display:"flex",alignItems:"center",justifyContent:"space-between",gap:16 }}>
            <Link href="/" style={{ display:"flex",alignItems:"baseline",textDecoration:"none",color:INK,fontSize:22,letterSpacing:"-1px" }}>
              <span style={{ fontWeight:300 }}>Pay</span><span style={{ fontWeight:700 }}>Hub</span>
              <span style={{ width:6,height:6,borderRadius:"50%",background:AMBER,display:"inline-block",marginLeft:3,marginBottom:4,alignSelf:"flex-end" }} />
            </Link>
            <div style={{ display:"flex",alignItems:"center",gap:20,fontSize:14 }}>
              <Link href="/demo" style={{ textDecoration:"none",color:MUTED,fontWeight:500,transition:"color .2s" }}
                onMouseEnter={e => e.currentTarget.style.color=INK}
                onMouseLeave={e => e.currentTarget.style.color=MUTED}>Demo</Link>
              {wallet
                ? <span style={{ display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:600,color:GREEN.text,background:GREEN.bg,border:`1px solid ${GREEN.border}`,padding:"5px 12px",borderRadius:100 }}>
                    <span style={{ width:6,height:6,borderRadius:"50%",background:"#22A05E",display:"inline-block" }} />
                    {wallet.address.slice(0,6)}...{wallet.address.slice(-4)}
                  </span>
                : <button onClick={connectClick} disabled={walletBusy}
                    style={{ display:"flex",alignItems:"center",gap:6,padding:"7px 16px",borderRadius:8,background:AMBER,border:"none",color:INK,fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"inherit" }}>
                    {walletBusy && <Spinner size={12} />}
                    {walletBusy ? "Connecting..." : "Connect Wallet"}
                  </button>
              }
            </div>
          </div>
        </nav>

        <div style={{ maxWidth:760,margin:"0 auto",padding:"48px 24px 80px" }}>
          <div style={{ marginBottom:36 }}>
            <div style={{ fontSize:12,fontWeight:700,color:"#C8841A",letterSpacing:".4px",textTransform:"uppercase",marginBottom:10 }}>Arbiter Panel</div>
            <h1 style={{ fontSize:"clamp(24px,3.5vw,36px)",letterSpacing:"-1.2px",fontWeight:700,marginBottom:8 }}>Payment inspector</h1>
            <p style={{ fontSize:15,color:MUTED }}>Look up any payment by ID to inspect its status, dispute state, and signed audit bundle.</p>
          </div>

          {/* Lookup */}
          <div style={{ display:"flex",gap:10,marginBottom:24 }}>
            <input value={lookup} onChange={e => setLookup(e.target.value)} onKeyDown={e => e.key==="Enter" && lookupPayment()}
              placeholder="Payment ID (e.g. 0)"
              style={{ flex:1,padding:"11px 14px",border:`1px solid ${BORDER}`,borderRadius:10,fontSize:14,fontFamily:"'Space Grotesk',monospace",color:INK,outline:"none" }}
              onFocus={e => e.currentTarget.style.borderColor=AMBER}
              onBlur={e => e.currentTarget.style.borderColor=BORDER} />
            <button onClick={lookupPayment} disabled={fetching||!lookup.trim()}
              style={{ padding:"11px 22px",borderRadius:10,background:AMBER,border:"none",color:INK,fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:8,opacity:fetching||!lookup.trim()?0.55:1 }}>
              {fetching ? <Spinner size={14} /> : null}
              {fetching ? "" : "Lookup"}
            </button>
          </div>

          {error && (
            <div style={{ padding:"12px 16px",background:RED.bg,border:`1px solid ${RED.border}`,borderRadius:10,fontSize:14,color:RED.text,marginBottom:20 }}>{error}</div>
          )}

          {payment && (
            <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
              {/* Summary */}
              <div style={{ background:"#fff",border:`1px solid ${BORDER}`,borderRadius:16,padding:"24px" }}>
                <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20,gap:12 }}>
                  <div>
                    <div style={{ fontSize:17,fontWeight:700 }}>{payment.orderId || "Payment"}</div>
                    <div style={{ fontSize:12,color:MUTED,fontFamily:"monospace",marginTop:4,wordBreak:"break-all" }}>{payment.paymentId}</div>
                  </div>
                  <StatusPill status={status} />
                </div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:18 }}>
                  {[
                    ["Amount",       amount],
                    ["Payer",        payment.onChain?.payer?.slice(0,14)+"..."],
                    ["Merchant",     payment.onChain?.merchant?.slice(0,14)+"..."],
                  ].map(([k,v]) => (
                    <div key={k} style={{ background:CREAM,borderRadius:10,padding:"10px 14px" }}>
                      <div style={{ fontSize:11.5,color:MUTED,fontWeight:600,marginBottom:3,textTransform:"uppercase",letterSpacing:".2px" }}>{k}</div>
                      <div style={{ fontSize:13,fontWeight:600,color:INK,wordBreak:"break-all" }}>{v}</div>
                    </div>
                  ))}
                </div>
                {status === "DISPUTED" && (
                  <div style={{ padding:"10px 14px",borderRadius:10,background:RED.bg,border:`1px solid ${RED.border}`,fontSize:13,color:RED.text }}>
                    Dispute open — merchant has 24h to respond. Auto-resolve available after the response window expires.
                  </div>
                )}
              </div>

              {/* Audit */}
              {audit && (
                <div style={{ background:"#fff",border:`1px solid ${GREEN.border}`,borderRadius:16,padding:"24px" }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18 }}>
                    <div style={{ fontSize:16,fontWeight:700 }}>Resolution Audit Report</div>
                    <button onClick={() => {
                      const b = new Blob([JSON.stringify(audit,null,2)],{type:"application/json"});
                      const u = URL.createObjectURL(b); const a = document.createElement("a");
                      a.href=u; a.download=`payhub-audit.json`; a.click(); URL.revokeObjectURL(u);
                    }} style={{ fontSize:12,fontWeight:600,color:MUTED,background:"none",border:`1px solid ${BORDER}`,borderRadius:6,padding:"5px 10px",cursor:"pointer",fontFamily:"inherit" }}>
                      Download JSON
                    </button>
                  </div>
                  {[
                    ["Status",        audit.payment?.status],
                    ["Verdict",       audit.resolution?.verdict],
                    ["Resolved at",   audit.resolution?.resolvedAt],
                  ].map(([k,v]) => v ? <Row key={k} label={k} value={v} /> : null)}
                  <div style={{ marginTop:14,padding:"10px 12px",background:CREAM,borderRadius:8,fontFamily:"monospace",fontSize:11,color:MUTED,wordBreak:"break-all" }}>
                    HMAC: {audit.signature}
                  </div>
                </div>
              )}
            </div>
          )}

          {!payment && !fetching && !error && (
            <div style={{ textAlign:"center",padding:"64px 0",color:MUTED }}>
              <div style={{ fontSize:40,marginBottom:16,opacity:.25 }}>🔍</div>
              <p style={{ fontSize:15 }}>Enter a payment ID above to inspect it</p>
              <p style={{ fontSize:13,marginTop:6 }}>Or <Link href="/demo" style={{ color:"#C8841A",textDecoration:"none",fontWeight:600 }}>run the demo</Link> to generate one</p>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes phspin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
}
