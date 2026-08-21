# PayHub

**Escrow and dispute rail for AI agent payments, on Stellar.**

PayHub is protocol infrastructure — an on-chain escrow, dispute, and refund layer that any agent payment system can plug into. It is not a consumer app; it is the recourse mechanism that sits underneath one. Payments are held in a Soroban smart contract rather than transferred directly, giving both payer and merchant a bounded window to dispute before funds settle.

> **Status:** The Soroban contract (`payhub-escrow`) is written, passes its test suite, and builds to a deployable wasm artifact — see [`contracts-soroban/README.md`](contracts-soroban/README.md) for exact status. It has not yet been deployed to Stellar testnet. No live demo or demo video exists yet for this version.

---

## The problem

AI agents can initiate payments. What they can't do is recover from a payment that goes wrong. When an agent pays a merchant and the merchant doesn't deliver, there's no recourse path enforced by anything other than trust.

PayHub fixes that. Every payment is escrowed on-chain; a payer has a fixed window to open a dispute; a merchant has a fixed window to respond; and if they don't, funds are refunded automatically. No backend has to be online, and no party can bypass `require_auth()` to act on someone else's behalf.

---

## How it works

```
Agent payment system            PayHub API                payhub-escrow (Soroban)
        │                            │                              │
        │── initiate_payment() ─────────────────────────────────────►│
        │   (signed via Freighter)   │        funds held in escrow   │
        │── POST /api/payments/register ──►                          │
        │                            │                                │
        │      [finality window — 3 days default]                    │
        │                            │                                │
        │── open_dispute() ─────────────────────────────────────────►│
        │── POST /api/payments/:id/dispute/register ──►               │
        │                            │                                │
        │      [merchant response window — 24h default]              │
        │                            │                                │
        │── POST /api/payments/:id/resolve ──►                        │
        │                            │── resolve_dispute() ──────────►│
        │◄── { audit } ──────────────│                                │
        │                            │                                │
        │── GET /api/payments/:id/audit ──►                           │
        │◄── signed audit bundle ────│                                │
```

---

## Integrating PayHub into your protocol

PayHub exposes a small REST API alongside the on-chain contract. Most state lives on-chain and is read directly; the API only stores off-chain context (order IDs, dispute reasons) and drives arbiter resolution.

### Step 1 — Payer signs `initiate_payment` via Freighter, then register it

```js
import { connectWallet, initiatePayment } from "./lib/wallet";

const wallet = await connectWallet();
const { txHash, paymentId } = await initiatePayment(wallet, {
  merchant: merchantAddress,
  token:    assetContractId,   // Soroban token/asset contract id
  amount:   "500000000",       // raw i128 stroops (7 decimals)
  orderId:  "your-order-id",
});

await fetch("/api/payments/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ paymentId, orderId, payerAddress: wallet.address, merchantAddress, amount, asset: assetContractId, txHash }),
});
```

### Step 2 — Let your users open disputes

```js
import { openDisputeOnChain } from "./lib/wallet";

const { txHash } = await openDisputeOnChain(wallet, paymentId, "Goods not delivered");

await fetch(`/api/payments/${paymentId}/dispute/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ reason: "Goods not delivered", txHash }),
});
```

### Contract functions (minimum required)

```rust
// contracts-soroban/payhub-escrow/src/lib.rs

initiate_payment(env, payer, merchant, token, amount, order_id, custom_finality) -> Result<u64, Error>
claim_payment(env, id) -> Result<(), Error>
open_dispute(env, id, reason) -> Result<(), Error>
respond_to_dispute(env, id, evidence) -> Result<(), Error>
resolve_dispute(env, caller, id, in_favor_of_payer) -> Result<(), Error>
auto_resolve_expired_dispute(env, id) -> Result<(), Error>
```

**Deployed contract:** not yet deployed. Once live on Stellar testnet, the contract id will be recorded in `deployment.json` and `.env.example`.

---

## Design notes

Where this differs from the original Solidity version built for Monad, and why:

| Difference | Why |
|---|---|
| No `msg.sender` | Soroban has no implicit caller identity — every privileged action takes an explicit `Address` and calls `.require_auth()` on it |
| `u64` payment ids, not hashes | Sequential integers returned by the contract, matching the pattern used by [`tributary`](https://github.com/Payhub-protocol/payhub)'s splitter contract |
| Typed `#[contracterror]` errors | Numeric codes instead of `require(..., "string")` reverts |
| No compliance gate | The original Monad version verified both parties' identity and screened transfers via a third-party compliance API before any token moved. That has no Stellar equivalent and was dropped entirely, not stubbed — this version has no identity-verification or transfer-screening step of any kind |

---

## Payment lifecycle

| Status | Description |
|--------|-------------|
| `Pending` | Funds escrowed, finality window active |
| `Settled` | Merchant claimed after window — no dispute possible |
| `Disputed` | Payer opened dispute before window closed |
| `Refunded` | Arbiter resolved in payer's favour, or the merchant response window expired — funds returned to source wallet |

Default windows (all configurable by contract owner):

| Window | Default |
|--------|---------|
| Finality | 3 days |
| Dispute | 2 days |
| Merchant response | 24 hours |
| Platform fee | 0.5% (max 2%) |

---

## API reference

Base URL: your deployed URL or `http://localhost:3000` locally. Full reference at [`/docs`](frontend/src/app/docs/page.jsx) once running.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/health` | Service health check |
| `POST` | `/api/payments/register` | Store off-chain metadata after on-chain `initiate_payment` |
| `GET`  | `/api/payments/:id` | Fetch payment, merging stored metadata with live on-chain state |
| `POST` | `/api/payments/:id/dispute/register` | Store dispute metadata after on-chain `open_dispute` |
| `POST` | `/api/payments/:id/resolve` | Arbiter resolves on-chain and generates the signed audit bundle |
| `POST` | `/api/payments/:id/auto-resolve` | Auto-refund after merchant misses the response window |
| `GET`  | `/api/payments/:id/audit` | Fetch signed HMAC audit bundle |

---

## Repository structure

```
payhub/
├── contracts-soroban/           # Current Rust/Soroban contract (Stellar)
│   └── payhub-escrow/
│       └── src/lib.rs
├── contracts/                   # Original Solidity contract (Monad) — retained for reference
├── backend/                     # Original standalone Express server (Monad) — retained for reference
├── frontend/                    # Next.js 15 app, adapted for Freighter + Soroban
│   └── src/
│       ├── app/
│       │   ├── page.jsx         # Landing page
│       │   ├── demo/            # Interactive demo flow
│       │   ├── docs/            # API reference
│       │   ├── dashboard/       # Arbiter payment inspector
│       │   └── api/             # Next.js API routes (backend logic)
│       └── lib/
│           ├── server/          # Server-side modules (chain, audit)
│           ├── wallet.js        # Freighter connector + Soroban contract calls
│           └── api.js           # API client (relative URLs)
├── deployment.json              # Deployed contract addresses (stale — Monad; pending Stellar redeploy)
└── .env.example                 # All required env vars
```

---

## Setup

### Prerequisites

- Node.js 18+
- Rust + the `wasm32v1-none` target (see [`contracts-soroban/README.md`](contracts-soroban/README.md) — on Windows, build and test from WSL, not natively)
- [Freighter](https://freighter.app) wallet extension, set to Testnet
- Testnet XLM from [Friendbot](https://lab.stellar.org/account/fund?$=network$id=testnet)

### 1. Clone and install

```bash
git clone https://github.com/Payhub-protocol/payhub.git
cd payhub
npm run install:all
```

### 2. Configure environment

```bash
cp .env.example .env
cp .env frontend/.env.local
```

See `.env.example` for the full list — Soroban RPC URL, the contract id (filled in after deploy), and the arbiter's secret key.

### 3. Build and test the contract

```bash
cd contracts-soroban
cargo test
cargo build --release --target wasm32v1-none -p payhub-escrow
```

### 4. Deploy to Stellar testnet

```bash
stellar keys generate deployer --network testnet --fund
stellar contract deploy \
  --wasm target/wasm32v1-none/release/payhub_escrow.wasm \
  --source deployer --network testnet
# Update PAYHUB_CONTRACT_ID and NEXT_PUBLIC_PAYHUB_CONTRACT in .env
```

### 5. Run the frontend locally

```bash
cd frontend
npm run dev
# → http://localhost:3000
```

---

## License

Apache-2.0
