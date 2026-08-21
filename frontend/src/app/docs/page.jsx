"use client";
import Link from "next/link";

const AMBER  = "#E8A020";
const INK    = "#0D1117";
const MUTED  = "#5B6470";
const BORDER = "#E8E7E2";
const CREAM  = "#FAF9F6";

function Code({ children }) {
  return <code style={{ fontFamily:"monospace",fontSize:13,background:CREAM,border:`1px solid ${BORDER}`,borderRadius:5,padding:"2px 7px",color:"#C8841A" }}>{children}</code>;
}

function Block({ children }) {
  return (
    <pre style={{ background:"#0D1117",color:"#E8E7E2",borderRadius:12,padding:"20px 22px",fontSize:13,lineHeight:1.7,overflowX:"auto",fontFamily:"monospace",margin:"12px 0 0" }}>
      {children}
    </pre>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom:48 }}>
      <h2 style={{ fontSize:22,fontWeight:700,letterSpacing:"-.5px",marginBottom:16,paddingBottom:12,borderBottom:`1px solid ${BORDER}` }}>{title}</h2>
      {children}
    </div>
  );
}

function Endpoint({ method, path, desc }) {
  const colors = { POST:"#3B82F6", GET:"#22A05E", DELETE:"#B91C1C" };
  return (
    <div style={{ display:"flex",alignItems:"flex-start",gap:12,padding:"12px 16px",border:`1px solid ${BORDER}`,borderRadius:10,marginBottom:8,background:"#fff" }}>
      <span style={{ fontSize:11,fontWeight:800,color:"#fff",background:colors[method]||MUTED,padding:"3px 8px",borderRadius:5,flexShrink:0,letterSpacing:".3px" }}>{method}</span>
      <div>
        <code style={{ fontSize:13.5,fontFamily:"monospace",color:INK,fontWeight:600 }}>{path}</code>
        <div style={{ fontSize:13,color:MUTED,marginTop:3 }}>{desc}</div>
      </div>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div style={{ background:"#fff",color:INK,minHeight:"100vh",fontFamily:"'Space Grotesk',system-ui,sans-serif" }}>

      {/* NAV */}
      <nav style={{ position:"sticky",top:0,zIndex:100,background:"rgba(255,255,255,.92)",backdropFilter:"saturate(180%) blur(14px)",borderBottom:`1px solid ${BORDER}` }}>
        <div style={{ maxWidth:900,margin:"0 auto",padding:"0 24px",height:64,display:"flex",alignItems:"center",justifyContent:"space-between",gap:16 }}>
          <Link href="/" style={{ display:"flex",alignItems:"baseline",textDecoration:"none",color:INK,fontSize:22,letterSpacing:"-1px" }}>
            <span style={{ fontWeight:300 }}>Pay</span><span style={{ fontWeight:700 }}>Hub</span>
            <span style={{ width:6,height:6,borderRadius:"50%",background:AMBER,display:"inline-block",marginLeft:3,marginBottom:4,alignSelf:"flex-end" }} />
          </Link>
          <div style={{ display:"flex",alignItems:"center",gap:20,fontSize:14,color:MUTED }}>
            <Link href="/demo" style={{ textDecoration:"none",color:MUTED,fontWeight:500,transition:"color .2s" }} onMouseEnter={e=>e.currentTarget.style.color=INK} onMouseLeave={e=>e.currentTarget.style.color=MUTED}>Demo</Link>
            <Link href="/dashboard" style={{ textDecoration:"none",color:MUTED,fontWeight:500,transition:"color .2s" }} onMouseEnter={e=>e.currentTarget.style.color=INK} onMouseLeave={e=>e.currentTarget.style.color=MUTED}>Dashboard</Link>
          </div>
        </div>
      </nav>

      <div style={{ maxWidth:860,margin:"0 auto",padding:"52px 24px 96px",display:"flex",gap:48 }}>

        {/* Sidebar */}
        <div style={{ width:180,flexShrink:0,display:"none" }} className="ph-sidebar">
          {[["Overview","#overview"],["Auth","#auth"],["Endpoints","#endpoints"],["Register","#payment"],["Disputes","#disputes"],["Audit","#audit"],["Contract","#contract"],["Design notes","#design"]].map(([l,h])=>(
            <a key={h} href={h} style={{ display:"block",fontSize:13.5,color:MUTED,textDecoration:"none",padding:"5px 0",fontWeight:500,transition:"color .2s" }} onMouseEnter={e=>e.currentTarget.style.color=INK} onMouseLeave={e=>e.currentTarget.style.color=MUTED}>{l}</a>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex:1,minWidth:0 }}>

          <div style={{ marginBottom:40 }}>
            <div style={{ fontSize:12,fontWeight:700,color:"#C8841A",letterSpacing:".4px",textTransform:"uppercase",marginBottom:10 }}>API Reference</div>
            <h1 style={{ fontSize:"clamp(26px,4vw,40px)",letterSpacing:"-1.2px",fontWeight:700,marginBottom:12 }}>PayHub API</h1>
            <p style={{ fontSize:16,color:MUTED,lineHeight:1.65,maxWidth:600 }}>
              A thin metadata layer on top of the <Code>payhub-escrow</Code> Soroban contract — most state lives on-chain and is read directly, this API only stores off-chain context (order IDs, dispute reasons, the signed audit bundle) and drives arbiter resolution.
              Base URL: <Code>http://localhost:3001</Code> (self-hosted).
            </p>
          </div>

          <Section title="Authentication" id="auth">
            <p style={{ fontSize:15,color:MUTED,lineHeight:1.7,marginBottom:16 }}>
              All requests are unauthenticated except <Code>POST /payments/:id/resolve</Code>, which requires an arbiter token in the request body. On-chain calls (<Code>initiate_payment</Code>, <Code>open_dispute</Code>, etc.) are authenticated separately by the caller's own Freighter signature via Soroban's <Code>require_auth()</Code> — this token only gates the off-chain API, not the contract.
            </p>
            <Block>{`// Arbiter auth — include in resolve requests
{
  "authToken": "your_arbiter_token"   // set via ARBITER_AUTH_TOKEN in .env
}`}</Block>
          </Section>

          <Section title="Endpoints" id="endpoints">
            <Endpoint method="POST" path="/payments/register" desc="Store off-chain metadata after on-chain initiate_payment confirms" />
            <Endpoint method="GET"  path="/payments/:id" desc="Fetch payment details, merging stored metadata with live on-chain state" />
            <Endpoint method="POST" path="/payments/:id/dispute/register" desc="Store dispute metadata after on-chain open_dispute confirms" />
            <Endpoint method="POST" path="/payments/:id/resolve" desc="Arbiter resolves on-chain and generates the signed audit bundle" />
            <Endpoint method="POST" path="/payments/:id/auto-resolve" desc="Refund to payer after the merchant response window expires" />
            <Endpoint method="GET"  path="/payments/:id/audit" desc="Fetch the signed HMAC audit bundle" />
            <Endpoint method="GET"  path="/health" desc="Service health check" />
          </Section>

          <Section title="POST /payments/register" id="payment">
            <p style={{ fontSize:15,color:MUTED,lineHeight:1.7,marginBottom:4 }}>
              Call immediately after <Code>initiate_payment</Code> confirms on-chain. Stores metadata so the payment can be looked up and the audit trail reconstructed — the payment id itself is a sequential <Code>u64</Code> returned by the contract, not a hash.
            </p>
            <Block>{`// Request
POST /payments/register
{
  "paymentId":       "0",         // u64 returned by initiate_payment
  "orderId":         "order_123",
  "payerAddress":    "GABC...",
  "merchantAddress": "GDEF...",
  "amount":          "500000000", // raw i128 stroops (7 decimals)
  "asset":           "C...",      // Soroban token/asset contract id
  "txHash":          "a1b2c3..."
}

// Response 200
{ "ok": true, "paymentId": "0" }`}</Block>
          </Section>

          <Section title="Disputes" id="disputes">
            <p style={{ fontSize:15,color:MUTED,lineHeight:1.7,marginBottom:16 }}>
              Only the original payer can open a dispute — enforced on-chain by <Code>payment.payer.require_auth()</Code> inside <Code>open_dispute</Code>, not by this API. The API just records the reason and hands off to the arbiter at resolution time.
            </p>
            <Block>{`// Step 1 — payer signs open_dispute on-chain via Freighter, then register it
POST /payments/:id/dispute/register
{ "reason": "Merchant did not deliver", "txHash": "a1b2c3..." }

// Step 2 — arbiter resolves (calls resolve_dispute on-chain)
POST /payments/:id/resolve
{
  "inFavorOfPayer": true,
  "verdict":        "Merchant did not provide delivery proof. Refund issued.",
  "authToken":      "your_arbiter_token"
}`}</Block>
          </Section>

          <Section title="GET /payments/:id/audit" id="audit">
            <p style={{ fontSize:15,color:MUTED,lineHeight:1.7,marginBottom:4 }}>
              Returns a signed HMAC audit bundle generated at resolution time — a tamper-evident record of what was paid, disputed, and how it was resolved.
            </p>
            <Block>{`// Response 200
{
  "payment": {
    "id":     "0",
    "status": "REFUNDED"
  },
  "dispute": {
    "reason":            "Merchant did not deliver",
    "openedAt":          "2026-06-18T08:00:00Z",
    "merchantResponded": false
  },
  "resolution": {
    "verdict":    "Merchant did not provide delivery proof. Refund issued.",
    "resolvedAt": "2026-06-18T10:00:00Z",
    "txHash":     "a1b2c3..."
  },
  "signature": "sha256=..."    // HMAC-signed — tamper-evident
}`}</Block>
          </Section>

          <Section title="Smart Contract" id="contract">
            <p style={{ fontSize:15,color:MUTED,lineHeight:1.7,marginBottom:12 }}>
              <Code>payhub-escrow</Code>, a from-scratch Soroban port of the original Solidity contract. Not yet deployed to testnet — see{" "}
              <a href="https://github.com/Payhub-protocol/payhub/tree/main/contracts-soroban" style={{ color:"#C8841A" }}>contracts-soroban/README.md</a> for current status.
            </p>
            <Block>{`// Key functions — contracts-soroban/payhub-escrow/src/lib.rs

// Payer initiates; funds move payer -> contract escrow in this call
initiate_payment(
  env: Env, payer: Address, merchant: Address, token: Address,
  amount: i128, order_id: String, custom_finality: u64  // 0 = 3-day default
) -> Result<u64, Error>   // returns the payment id

// Merchant claims once the finality window has elapsed
claim_payment(env: Env, id: u64) -> Result<(), Error>

// Payer opens a dispute before the dispute window closes (2 days default)
open_dispute(env: Env, id: u64, reason: String) -> Result<(), Error>

// Merchant submits evidence within the response window (24h default)
respond_to_dispute(env: Env, id: u64, evidence: String) -> Result<(), Error>

// Arbiter resolves — no verdict string on-chain, that lives in the audit bundle
resolve_dispute(
  env: Env, caller: Address, id: u64, in_favor_of_payer: bool
) -> Result<(), Error>

// Anyone can call once the merchant misses the response window
auto_resolve_expired_dispute(env: Env, id: u64) -> Result<(), Error>`}</Block>
          </Section>

          <Section title="Design notes" id="design">
            <p style={{ fontSize:15,color:MUTED,lineHeight:1.7,marginBottom:16 }}>
              Where this contract differs from the original Solidity version, and why.
            </p>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10 }}>
              {[
                ["No msg.sender","Auth","Soroban has no implicit caller identity. Every privileged action takes an explicit Address and calls .require_auth() on it."],
                ["u64 ids","Payment IDs","Sequential integers returned by the contract, not a keccak256 hash — matches the pattern used by tributary's splitter contract."],
                ["Typed errors","#[contracterror]","Numeric error codes instead of require(..., \"string\") reverts, documented on each variant."],
                ["No compliance gate","Scope","A-Pass identity verification and CCP/Travel-Rule screening from the Monad version have no Stellar equivalent and were dropped, not stubbed."],
              ].map(([name,tag,desc])=>(
                <div key={name} style={{ background:CREAM,border:`1px solid ${BORDER}`,borderRadius:12,padding:"16px 16px 18px" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:8 }}>
                    <span style={{ fontSize:11,fontWeight:800,color:"#C8841A",background:"#FCF4E4",border:"1px solid #F4E3C0",padding:"3px 8px",borderRadius:5 }}>{name}</span>
                    <span style={{ fontSize:12,color:MUTED,fontWeight:600 }}>{tag}</span>
                  </div>
                  <p style={{ fontSize:13,color:MUTED,lineHeight:1.6,margin:0 }}>{desc}</p>
                </div>
              ))}
            </div>
          </Section>

          <div style={{ padding:"24px",background:CREAM,border:`1px solid ${BORDER}`,borderRadius:14 }}>
            <div style={{ fontSize:14,fontWeight:700,marginBottom:6 }}>Try it live</div>
            <p style={{ fontSize:14,color:MUTED,marginBottom:14,lineHeight:1.6 }}>Walk through the full integration flow — escrow, dispute, resolution, and audit download.</p>
            <Link href="/demo" style={{ display:"inline-flex",padding:"10px 20px",borderRadius:9,background:AMBER,color:INK,fontWeight:700,fontSize:14,textDecoration:"none" }}>Open demo →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
