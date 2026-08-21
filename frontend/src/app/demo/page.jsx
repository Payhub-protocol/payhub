"use client";
import { useState, useEffect } from "react";
import { connectWallet, initiatePayment, openDisputeOnChain } from "../../lib/wallet";
import { api } from "../../lib/api";
import Link from "next/link";

// ─── Design tokens (matches landing page) ─────────────────────────────────────
const AMBER  = "#E8A020";
const INK    = "#0D1117";
const MUTED  = "#5B6470";
const BORDER = "#E8E7E2";
const CREAM  = "#FAF9F6";
const GREEN  = { text:"#1B7A4B", bg:"#E9F7EF", border:"#BBE5CF" };
const RED    = { text:"#B91C1C", bg:"#FEF2F2", border:"#FECACA" };

const DEMO_ORDER_ID = `demo_${Date.now()}`;
// Soroban asset amounts are raw i128 stroops (7 decimals for most Stellar assets).
const DEMO_AMOUNT_DISPLAY = "50";
const DEMO_AMOUNT = 50n * 10_000_000n;
// Placeholders until payhub-escrow and a test asset are deployed to testnet
// (see contracts-soroban/README.md "Status").
const TOKEN_ADDR = process.env.NEXT_PUBLIC_DEMO_TOKEN_CONTRACT || "C... (test asset not deployed yet)";
const PAYHUB     = process.env.NEXT_PUBLIC_PAYHUB_CONTRACT || "C... (payhub-escrow not deployed yet)";

// ─── Shared atoms ─────────────────────────────────────────────────────────────
function Btn({ onClick, disabled, loading, children, variant = "primary" }) {
  const base = { display:"flex",alignItems:"center",justifyContent:"center",gap:8,width:"100%",padding:"13px 20px",borderRadius:10,fontFamily:"inherit",fontSize:15,fontWeight:600,cursor:disabled||loading?"not-allowed":"pointer",transition:"all .15s",border:"none" };
  const variants = {
    primary: { ...base, background:AMBER, color:INK, boxShadow:"0 4px 14px -6px rgba(232,160,32,.5)", opacity:disabled||loading?0.55:1 },
    ghost:   { ...base, background:"transparent", color:INK, border:`1px solid ${BORDER}`, opacity:disabled||loading?0.55:1 },
    danger:  { ...base, background:RED.bg, color:RED.text, border:`1px solid ${RED.border}`, opacity:disabled||loading?0.55:1 },
  };
  return (
    <button onClick={onClick} disabled={disabled||loading} style={variants[variant]}
      onMouseEnter={e => { if (!disabled&&!loading) e.currentTarget.style.transform="translateY(-1px)"; }}
      onMouseLeave={e => e.currentTarget.style.transform=""}>
      {loading && <Spinner size={15} />}
      {children}
    </button>
  );
}

function Spinner({ size = 16, color = INK }) {
  return <div style={{ width:size,height:size,border:`2px solid ${color}22`,borderTopColor:color,borderRadius:"50%",flexShrink:0,animation:"phspin .6s linear infinite" }} />;
}

function Card({ children, accent }) {
  return (
    <div style={{ background:"#fff",border:`1px solid ${accent ? AMBER : BORDER}`,borderRadius:16,padding:"24px 24px 26px",boxShadow:accent?"0 0 0 3px rgba(232,160,32,.1)":"0 1px 4px rgba(13,17,23,.05)" }}>
      {children}
    </div>
  );
}

function StepDot({ n, active, done }) {
  if (done) return (
    <div style={{ width:34,height:34,borderRadius:"50%",background:GREEN.bg,border:`2px solid ${GREEN.border}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5L12 4" stroke={GREEN.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </div>
  );
  if (active) return (
    <div style={{ width:34,height:34,borderRadius:"50%",background:"#FCF4E4",border:`2px solid ${AMBER}`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:14,color:"#C8841A",flexShrink:0 }}>{n}</div>
  );
  return (
    <div style={{ width:34,height:34,borderRadius:"50%",background:CREAM,border:`2px solid ${BORDER}`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:600,fontSize:14,color:"#B0B8C1",flexShrink:0 }}>{n}</div>
  );
}

function StepHeader({ n, title, subtitle, active, done }) {
  return (
    <div style={{ display:"flex",alignItems:"flex-start",gap:14,marginBottom:20,opacity:!active&&!done?0.45:1 }}>
      <StepDot n={n} active={active} done={done} />
      <div>
        <div style={{ fontSize:16,fontWeight:700,color:INK,lineHeight:1.3 }}>{title}</div>
        {subtitle && <div style={{ fontSize:13.5,color:MUTED,marginTop:3,lineHeight:1.5 }}>{subtitle}</div>}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DemoPage() {
  const [wallet,       setWallet]       = useState(null);
  const [connecting,   setConnecting]   = useState(false);
  const [step,         setStep]         = useState(0);
  const [busy,         setBusy]         = useState(false);
  const [payStatus,    setPayStatus]    = useState(null);
  const [error,        setError]        = useState(null);
  const [merchantAddr, setMerchantAddr] = useState("");
  const [paymentId,    setPaymentId]    = useState(null);
  const [payTx,        setPayTx]        = useState(null);
  const [disputeTx,    setDisputeTx]    = useState(null);
  const [disputeReason,setDisputeReason]= useState("Product was not delivered");
  const [audit,        setAudit]        = useState(null);

  useEffect(() => { if (wallet && step === 0) setStep(1); }, [wallet]);

  const err = (msg) => { setError(msg); setBusy(false); };

  async function connectClick() {
    setConnecting(true); setError(null);
    try {
      const w = await connectWallet();
      setWallet(w);
    } catch (e) {
      setError(e.message);
    } finally {
      setConnecting(false);
    }
  }

  async function pay() {
    if (!wallet || !merchantAddr) return;
    if (merchantAddr === wallet.address)
      return setError("Merchant address cannot be the same as your connected wallet. Use a different address.");
    setBusy(true); setError(null); setPayStatus(null);
    try {
      setPayStatus("Sending payment — confirm in Freighter…");
      const { txHash, paymentId: pid } = await initiatePayment(wallet.address, {
        merchant: merchantAddr,
        token: TOKEN_ADDR,
        amount: DEMO_AMOUNT,
        orderId: DEMO_ORDER_ID,
      });
      setPayStatus("Registering payment…");
      await api.registerPayment({
        paymentId: String(pid), orderId: DEMO_ORDER_ID,
        payerAddress: wallet.address, merchantAddress: merchantAddr,
        amount: DEMO_AMOUNT.toString(), asset: TOKEN_ADDR,
        txHash,
      });
      setPaymentId(pid); setPayTx(txHash); setStep(2);
    } catch (e) {
      err(e.message || "Payment failed.");
    } finally { setBusy(false); setPayStatus(null); }
  }

  async function openDispute() {
    if (!wallet || paymentId == null) return;
    setBusy(true); setError(null); setPayStatus(null);
    try {
      setPayStatus("Opening dispute — confirm in Freighter…");
      const { txHash } = await openDisputeOnChain(wallet.address, paymentId, disputeReason);
      setPayStatus("Registering dispute…");
      await api.registerDispute(String(paymentId), { reason: disputeReason, txHash });
      setDisputeTx(txHash); setStep(3);
    } catch (e) {
      err(e.message || "Dispute failed.");
    } finally { setBusy(false); setPayStatus(null); }
  }

  async function resolve() {
    if (paymentId == null) return;
    setBusy(true); setError(null);
    try {
      const result = await api.resolve(String(paymentId), {
        inFavorOfPayer: true,
        verdict:        "Merchant did not respond within the response window. Refund issued to original payer.",
        authToken:      process.env.NEXT_PUBLIC_ARBITER_TOKEN || "demo_arbiter_token",
      });
      setAudit(result.audit); setStep(4);
    } catch (e) { err(e.message); } finally { setBusy(false); }
  }

  const shortAddr = (a) => a ? `${a.slice(0,6)}...${a.slice(-6)}` : "";

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
            <div style={{ display:"flex",alignItems:"center",gap:20,fontSize:14,color:MUTED }}>
              <Link href="/" style={{ textDecoration:"none",color:MUTED,fontWeight:500,transition:"color .2s" }}
                onMouseEnter={e => e.currentTarget.style.color=INK}
                onMouseLeave={e => e.currentTarget.style.color=MUTED}>Home</Link>
              <Link href="/dashboard" style={{ textDecoration:"none",color:MUTED,fontWeight:500,transition:"color .2s" }}
                onMouseEnter={e => e.currentTarget.style.color=INK}
                onMouseLeave={e => e.currentTarget.style.color=MUTED}>Dashboard</Link>
              {wallet
                ? <span style={{ display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:600,color:GREEN.text,background:GREEN.bg,border:`1px solid ${GREEN.border}`,padding:"5px 12px",borderRadius:100 }}>
                    <span style={{ width:6,height:6,borderRadius:"50%",background:"#22A05E",display:"inline-block" }} />
                    {shortAddr(wallet.address)}
                  </span>
                : <button onClick={connectClick} disabled={connecting}
                    style={{ display:"flex",alignItems:"center",gap:7,padding:"7px 16px",borderRadius:8,background:AMBER,border:"none",color:INK,fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"inherit" }}>
                    {connecting ? <Spinner size={13} /> : null}
                    {connecting ? "Connecting..." : "Connect Freighter"}
                  </button>
              }
            </div>
          </div>
        </nav>

        <div style={{ maxWidth:740,margin:"0 auto",padding:"48px 24px 80px" }}>

          {/* Header */}
          <div style={{ textAlign:"center",marginBottom:48 }}>
            <div style={{ display:"inline-flex",alignItems:"center",gap:7,fontSize:12,fontWeight:700,color:"#C8841A",background:"#FCF4E4",border:"1px solid #F4E3C0",padding:"6px 14px",borderRadius:100,marginBottom:16,letterSpacing:".3px",textTransform:"uppercase" }}>
              Protocol Demo — Stellar Testnet
            </div>
            <h1 style={{ fontSize:"clamp(28px,4vw,42px)",letterSpacing:"-1.5px",fontWeight:700,marginBottom:12 }}>An agent payment — and its chargeback</h1>
            <p style={{ fontSize:16.5,color:MUTED,lineHeight:1.65,maxWidth:520,margin:"0 auto" }}>
              This is what a PayHub integration looks like end-to-end: on-chain escrow, a dispute window, and a refund that returns to the original payer — no human needed.
            </p>
          </div>

          {/* Progress bar */}
          <div style={{ display:"flex",gap:4,marginBottom:40 }}>
            {["Connect","Pay","Dispute","Resolve","Audit"].map((label, i) => (
              <div key={i} style={{ flex:1,textAlign:"center" }}>
                <div style={{ height:3,borderRadius:2,background:i<=step?AMBER:"#F0EFEA",transition:"background .4s",marginBottom:6 }} />
                <div style={{ fontSize:10,fontWeight:600,color:i<=step?"#C8841A":"#B0B8C1",textTransform:"uppercase",letterSpacing:".3px",display:"none" }} className="ph-sl">{label}</div>
              </div>
            ))}
          </div>

          {error && (
            <div style={{ display:"flex",alignItems:"flex-start",gap:10,padding:"12px 16px",background:RED.bg,border:`1px solid ${RED.border}`,borderRadius:12,marginBottom:20,fontSize:14,color:RED.text }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginTop:1,flexShrink:0 }}><circle cx="8" cy="8" r="7" fill={RED.bg} stroke={RED.border}/><path d="M8 5v3m0 2.5v.5" stroke={RED.text} strokeWidth="1.5" strokeLinecap="round"/></svg>
              {error}
            </div>
          )}

          <div style={{ display:"flex",flexDirection:"column",gap:16 }}>

            {/* Step 0: Connect */}
            <Card accent={step===0}>
              <StepHeader n="1" title="Connect Wallet" subtitle="Freighter, on Stellar Testnet" active={step===0} done={step>0} />
              {step === 0 && (
                wallet
                  ? <div style={{ display:"flex",alignItems:"center",gap:8,fontSize:14,color:GREEN.text,fontWeight:500 }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill={GREEN.bg} stroke={GREEN.border}/><path d="M5 8l2 2 4-4" stroke={GREEN.text} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Connected: {shortAddr(wallet.address)}
                    </div>
                  : <div style={{ flex:1 }}><Btn onClick={connectClick} loading={connecting}>Connect Freighter</Btn></div>
              )}
              {step > 0 && (
                <div style={{ display:"flex",alignItems:"center",gap:8,fontSize:14,color:GREEN.text,fontWeight:500 }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5L12 4" stroke={GREEN.text} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  {shortAddr(wallet?.address)}
                </div>
              )}
            </Card>

            {/* Step 1: Pay */}
            {step >= 1 && (
              <Card accent={step===1}>
                <StepHeader n="2" title="Initiate Payment" subtitle={`${DEMO_AMOUNT_DISPLAY} test asset held in payhub-escrow during the finality window`} active={step===1} done={step>1} />
                {step === 1 && (
                  <>
                    <div style={{ marginBottom:16 }}>
                      <label style={{ display:"block",fontSize:13,fontWeight:600,color:INK,marginBottom:6 }}>Merchant address (G...)</label>
                      <input value={merchantAddr} onChange={e => setMerchantAddr(e.target.value)} placeholder="G..."
                        style={{ width:"100%",padding:"11px 14px",border:`1px solid ${BORDER}`,borderRadius:10,fontSize:14,fontFamily:"'Space Grotesk',monospace",color:INK,background:"#fff",outline:"none",boxSizing:"border-box" }}
                        onFocus={e => e.currentTarget.style.borderColor=AMBER}
                        onBlur={e => e.currentTarget.style.borderColor=BORDER} />
                    </div>
                    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:18 }}>
                      {[["Order",DEMO_ORDER_ID.slice(0,22)+"..."],["Amount",`${DEMO_AMOUNT_DISPLAY} test asset`],["Token",TOKEN_ADDR.slice(0,10)+"..."],["Contract",PAYHUB.slice(0,10)+"..."]].map(([k,v]) => (
                        <div key={k} style={{ background:CREAM,borderRadius:10,padding:"10px 14px" }}>
                          <div style={{ fontSize:12,color:MUTED,fontWeight:500,marginBottom:3 }}>{k}</div>
                          <div style={{ fontSize:13.5,fontWeight:600,color:v.includes("not deployed")?RED.text:INK,wordBreak:"break-all" }}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <Btn onClick={pay} loading={busy} disabled={!merchantAddr || busy}>Pay {DEMO_AMOUNT_DISPLAY} test asset</Btn>
                    {payStatus && <div style={{ marginTop:10,fontSize:13,color:MUTED,textAlign:"center" }}>{payStatus}</div>}
                  </>
                )}
                {payTx && (
                  <div style={{ marginTop:12,fontSize:12,color:GREEN.text,wordBreak:"break-all",fontFamily:"monospace" }}>Tx: {payTx}</div>
                )}
              </Card>
            )}

            {/* Step 2: Dispute */}
            {step >= 2 && (
              <Card accent={step===2}>
                <StepHeader n="3" title="Open Dispute" subtitle="Only the original payer can open this" active={step===2} done={step>2} />
                {step === 2 && (
                  <>
                    <div style={{ padding:"12px 14px",background:RED.bg,border:`1px solid ${RED.border}`,borderRadius:10,marginBottom:16,fontSize:14,color:RED.text }}>
                      Scenario: the merchant received payment but has not delivered the goods.
                    </div>
                    <div style={{ marginBottom:16 }}>
                      <label style={{ display:"block",fontSize:13,fontWeight:600,color:INK,marginBottom:6 }}>Dispute reason</label>
                      <div style={{ width:"100%",padding:"11px 14px",border:`1px solid ${BORDER}`,borderRadius:10,fontSize:14,color:MUTED,background:CREAM,boxSizing:"border-box" }}>{disputeReason}</div>
                    </div>
                    <Btn onClick={openDispute} loading={busy} variant="danger">Open Dispute</Btn>
                    {payStatus && <div style={{ marginTop:10,fontSize:13,color:MUTED,textAlign:"center" }}>{payStatus}</div>}
                  </>
                )}
                {disputeTx && (
                  <div style={{ marginTop:12,fontSize:12,color:RED.text,wordBreak:"break-all",fontFamily:"monospace" }}>Dispute tx: {disputeTx}</div>
                )}
              </Card>
            )}

            {/* Step 3: Resolve */}
            {step >= 3 && (
              <Card accent={step===3}>
                <StepHeader n="4" title="Arbiter Resolves" subtitle="Funds return to the payer if the merchant doesn't respond in time." active={step===3} done={step>3} />
                {step === 3 && (
                  <>
                    <div style={{ background:CREAM,borderRadius:10,padding:"14px 16px",marginBottom:18,fontSize:14,color:MUTED,lineHeight:1.6 }}>
                      <div>Merchant response window: <strong style={{ color:INK }}>24 hours</strong></div>
                      <div>Merchant responded: <strong style={{ color:RED.text }}>No</strong></div>
                      <div style={{ marginTop:8 }}>Resolving in favour of the payer.</div>
                    </div>
                    <Btn onClick={resolve} loading={busy}>Resolve and Refund to Source</Btn>
                  </>
                )}
              </Card>
            )}

            {/* Step 4: Audit */}
            {step >= 4 && (
              <Card accent>
                <StepHeader n="5" title="Audit Bundle" subtitle="Every step signed and exportable" active done />
                <div style={{ display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:GREEN.bg,border:`1px solid ${GREEN.border}`,borderRadius:12,marginBottom:20 }}>
                  <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="10" fill={GREEN.bg} stroke={GREEN.border} strokeWidth="1.5"/><path d="M7 11l3 3 5-5" stroke={GREEN.text} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <div>
                    <div style={{ fontWeight:700,color:GREEN.text,fontSize:15 }}>Refund complete</div>
                    <div style={{ fontSize:13,color:MUTED,marginTop:2 }}>{DEMO_AMOUNT_DISPLAY} test asset returned to the original payer wallet. Refund-to-source enforced by payhub-escrow.</div>
                  </div>
                </div>

                {audit && (
                  <div style={{ border:`1px solid ${BORDER}`,borderRadius:12,overflow:"hidden" }}>
                    <div style={{ background:CREAM,padding:"12px 16px",borderBottom:`1px solid ${BORDER}`,display:"flex",alignItems:"center",justifyContent:"space-between" }}>
                      <span style={{ fontSize:14,fontWeight:700 }}>Resolution Audit Report</span>
                      <button onClick={() => {
                        const b = new Blob([JSON.stringify(audit,null,2)],{type:"application/json"});
                        const u = URL.createObjectURL(b); const a = document.createElement("a");
                        a.href=u; a.download=`payhub-audit.json`; a.click(); URL.revokeObjectURL(u);
                      }} style={{ fontSize:12,fontWeight:600,color:MUTED,background:"none",border:`1px solid ${BORDER}`,borderRadius:6,padding:"5px 10px",cursor:"pointer",fontFamily:"inherit" }}>
                        Download JSON
                      </button>
                    </div>
                    <div style={{ padding:"16px" }}>
                      {[
                        ["Payment ID",  audit.payment?.id],
                        ["Status",      audit.payment?.status],
                        ["Resolution",  audit.resolution?.verdict],
                        ["Resolved at", audit.resolution?.resolvedAt],
                      ].map(([k,v]) => v ? (
                        <div key={k} style={{ display:"flex",justifyContent:"space-between",gap:16,padding:"8px 0",borderBottom:`1px solid #F5F4F0`,fontSize:13 }}>
                          <span style={{ color:MUTED,fontWeight:500,flexShrink:0 }}>{k}</span>
                          <span style={{ color:INK,fontWeight:600,textAlign:"right",wordBreak:"break-all" }}>{String(v)}</span>
                        </div>
                      ) : null)}
                      <div style={{ marginTop:14,padding:"10px 12px",background:CREAM,borderRadius:8,fontFamily:"monospace",fontSize:11,color:MUTED,wordBreak:"break-all" }}>
                        HMAC: {audit.signature}
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ marginTop:20 }}>
                  <Link href="/dashboard" style={{ textDecoration:"none" }}>
                    <Btn variant="ghost">View in Dashboard</Btn>
                  </Link>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
      <style>{`@keyframes phspin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
}
