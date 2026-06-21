# PayHub

**Dispute and chargeback rail for AI agent payments on Monad.**

Built for the [Cleanverse Verified Finance Hackathon](https://cleanverse.com). PayHub is protocol infrastructure — a dispute, escrow, and compliance layer that any agent payment system can plug into. It is not a consumer app; it is the recourse mechanism that sits underneath one.

[![Live Demo](https://img.shields.io/badge/demo-trypayhub.vercel.app-E8A020?style=flat&logo=vercel&logoColor=black)](https://trypayhub.vercel.app)
[![Demo Video](https://img.shields.io/badge/demo_video-YouTube-FF0000?style=flat&logo=youtube&logoColor=white)](https://youtu.be/SDXThRLcHqY)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/IamHarrie-Labs/payhub&root=frontend)

---

## The problem

AI agents can initiate payments. What they can't do is recover from a payment that goes wrong. When an agent pays a merchant and the merchant doesn't deliver, there's no identity-bound recourse: no compliance trail an auditor could verify, no refund path a financial regulator would accept.

PayHub fixes that. Every payment is escrowed on-chain, both parties are A-Pass verified before a single token moves, and any refund is CCP-screened before execution — with a tamper-evident audit bundle at the end.

---

## How it works

```
Agent payment system                PayHub                        Monad chain
        │                              │                               │
        │── POST /api/payments/preflight ──►                           │
        │   A-Pass + CCP + Travel Rule check                           │
        │◄── { cleared: true, apassPayer, apassMerchant } ────────────│
        │                              │                               │
        │── initiatePayment() ────────────────────────────────────────►│
        │                              │         funds held in escrow  │
        │── POST /api/payments/register ──►                            │
        │                              │                               │
        │         [finality window — 3 days default]                   │
        │                              │                               │
        │── openDispute() ────────────────────────────────────────────►│
        │── POST /api/payments/:id/dispute/preflight ──►               │
        │   (re-verifies payer A-Pass before submitting)               │
        │── POST /api/payments/:id/dispute/register  ──►               │
        │                              │                               │
        │         [arbiter reviews, CCP screens refund]                │
        │                              │                               │
        │── POST /api/payments/:id/resolve ──►                         │
        │                              │── resolveDispute() ──────────►│
        │◄── { audit } ────────────────│                               │
        │                              │                               │
        │── GET /api/payments/:id/audit ──►                            │
        │◄── signed audit bundle ──────│                               │
```

---

## Integrating PayHub into your protocol

PayHub exposes a simple REST API. Add dispute resolution to your agent payment system in three steps.

### Step 1 — Run compliance preflight before any on-chain call

```js
const preflight = await fetch("/api/payments/preflight", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    payerAddress:    agentWallet,       // the paying agent's wallet
    merchantAddress: merchantWallet,    // the merchant wallet
    amount:          "50000000",        // in token base units (6 decimals for aUSDC)
    asset:           ATOKEN_ADDRESS,    // the A-Token contract address
    orderId:         "your-order-id",
  }),
}).then(r => r.json());

if (!preflight.cleared) throw new Error("Compliance check failed");

// preflight.apassPayer    — Cleanverse A-Pass ID for payer   (pass to contract)
// preflight.apassMerchant — Cleanverse A-Pass ID for merchant (pass to contract)
// preflight.travelRuleId  — Travel Rule reference
```

### Step 2 — Call initiatePayment on-chain, then register with the backend

```js
// On-chain (ethers.js)
const tx = await payhubContract.initiatePayment(
  merchantWallet,
  ATOKEN_ADDRESS,
  amount,
  orderId,
  preflight.apassPayer,    // stored on-chain for audit trail
  preflight.apassMerchant,
  0                        // 0 = use default 3-day finality window
);
const receipt = await tx.wait();

// Extract paymentId from PaymentInitiated event
const event = receipt.logs
  .map(l => { try { return payhubInterface.parseLog(l); } catch { return null; } })
  .find(e => e?.name === "PaymentInitiated");
const paymentId = event.args.paymentId;

// Register with backend (attaches Travel Rule + compliance metadata)
await fetch("/api/payments/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    paymentId, orderId, payerAddress, merchantAddress,
    amount, asset: ATOKEN_ADDRESS,
    apassPayer:   preflight.apassPayer,
    apassMerchant: preflight.apassMerchant,
    travelRuleId: preflight.travelRuleId,
    txHash:       receipt.hash,
  }),
});
```

### Step 3 — Let your users open disputes

```js
// Verify identity before submitting the on-chain transaction
const check = await fetch(`/api/payments/${paymentId}/dispute/preflight`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ callerAddress: userWallet }),
}).then(r => r.json());

if (!check.eligible) throw new Error(check.error);

// Submit dispute on-chain
const tx = await payhubContract.openDispute(paymentId, "Goods not delivered");
await tx.wait();

// Register the dispute
await fetch(`/api/payments/${paymentId}/dispute/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ reason: "Goods not delivered", txHash: tx.hash }),
});
```

### Contract ABI (minimum required)

```solidity
function initiatePayment(
  address merchant,
  address token,
  uint256 amount,
  string  orderId,
  string  apassPayer,      // A-Pass ID from preflight response
  string  apassMerchant,   // A-Pass ID from preflight response
  uint256 customFinality   // 0 = use 3-day default
) external returns (bytes32 paymentId)

function openDispute(bytes32 paymentId, string reason) external

function respondToDispute(bytes32 paymentId, string evidence) external

function resolveDispute(bytes32 paymentId, bool inFavorOfPayer, string verdict) external

function autoResolveExpiredDispute(bytes32 paymentId) external
```

**Deployed contract:** [`0x7BBDa4409e300eaDB0A61F137498480c96173C9e`](https://testnet.monad.xyz/address/0x7BBDa4409e300eaDB0A61F137498480c96173C9e) on Monad Testnet (Chain ID: 10143)

---

## Cleanverse compliance primitives

| Primitive | Where enforced | What it does |
|-----------|---------------|--------------|
| **A-Pass** | `preflight` | Both payer and merchant identity verified before payment |
| **A-Pass** | `dispute/preflight` | Payer identity re-verified at dispute time |
| **CCP** | `preflight` | Payment leg screened against AML + sanctions |
| **CCP** | `resolve` | Refund leg screened before execution |
| **Travel Rule** | Both legs | Originator/beneficiary metadata attached automatically |
| **A-Token** | Escrow contract | Compliant stablecoin (aUSDC) held in PayHub escrow |

No on-chain transaction is submitted without a backend compliance pre-check. The smart contract stores A-Pass IDs on-chain for a permanent audit trail.

---

## Payment lifecycle

| Status | Description |
|--------|-------------|
| `PENDING` | Funds escrowed, finality window active |
| `SETTLED` | Merchant claimed after window — no dispute possible |
| `DISPUTED` | Payer opened dispute before window closed |
| `REFUNDED` | Arbiter resolved in payer's favour — funds returned to source wallet |

Default windows (all configurable by contract owner):

| Window | Default |
|--------|---------|
| Finality | 3 days |
| Dispute | 2 days |
| Merchant response | 24 hours |
| Platform fee | 0.5% (max 2%) |

---

## API reference

Base URL: your deployed Vercel URL or `http://localhost:3000` locally.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/health` | Service health check |
| `POST` | `/api/payments/preflight` | A-Pass + CCP + Travel Rule pre-check |
| `POST` | `/api/payments/register` | Store compliance metadata after on-chain tx |
| `GET`  | `/api/payments/:id` | Fetch payment + on-chain status |
| `POST` | `/api/payments/:id/dispute/preflight` | Verify payer identity before dispute |
| `POST` | `/api/payments/:id/dispute/register` | Store dispute metadata |
| `POST` | `/api/payments/:id/resolve` | Arbiter resolves; CCP screens refund first |
| `POST` | `/api/payments/:id/auto-resolve` | Auto-refund after merchant misses response window |
| `GET`  | `/api/payments/:id/audit` | Fetch signed HMAC audit bundle |

---

## Repository structure

```
payhub/
├── contracts/
│   ├── contracts/
│   │   ├── PayHub.sol          # Escrow + dispute contract
│   │   └── MockERC20.sol       # Test token (freely mintable)
│   ├── scripts/
│   │   ├── deploy.js           # Deploy PayHub
│   │   └── deploy_mock.js      # Deploy + mint MockERC20 for demo
│   ├── test/
│   │   └── PayHub.test.js      # 7 contract tests
│   └── hardhat.config.js
├── backend/                    # Standalone Express server (optional — same logic lives in frontend/src/app/api/)
│   └── src/
│       ├── index.js
│       ├── cleanverse.js
│       ├── chain.js
│       └── audit.js
├── frontend/                   # Next.js 15 app — deploy this to Vercel
│   └── src/
│       ├── app/
│       │   ├── page.jsx        # Landing page
│       │   ├── demo/           # Interactive demo flow
│       │   ├── docs/           # API reference
│       │   ├── dashboard/      # Arbiter payment inspector
│       │   └── api/            # Next.js API routes (backend logic)
│       │       └── payments/   # All payment + dispute endpoints
│       └── lib/
│           ├── server/         # Server-side modules (cleanverse, chain, audit)
│           ├── wallet.js       # MetaMask connector + contract helpers
│           └── api.js          # API client (relative URLs)
├── deployment.json             # Deployed contract addresses
└── .env.example                # All required env vars
```

---

## Setup

### Prerequisites

- Node.js 18+
- MetaMask with Monad Testnet configured (Chain ID: 10143)
- Testnet MON from the [Monad faucet](https://faucet.monad.xyz)
- Cleanverse sandbox credentials (from [cleanverse.com](https://cleanverse.com))

### 1. Clone and install

```bash
git clone https://github.com/IamHarrie-Labs/payhub.git
cd payhub
npm run install:all
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in your values, then:
cp .env backend/.env
cp .env frontend/.env.local
```

Required values:

```env
CLEANVERSE_API_BASE=https://uatapi.cleanverse.com/api/cooperate
CLEANVERSE_APP_ID=your_app_id
CLEANVERSE_API_KEY=your_api_key

MONAD_RPC_URL=https://testnet-rpc.monad.xyz
DEPLOYER_PRIVATE_KEY=0x...
ARBITER_PRIVATE_KEY=0x...
ARBITER_ADDRESS=0x...
FEE_RECIPIENT=0x...

PAYHUB_CONTRACT_ADDRESS=0x...      # filled after deploy
NEXT_PUBLIC_PAYHUB_CONTRACT=0x...  # same address
NEXT_PUBLIC_ATOKEN_ADDRESS=0x...   # A-Token to use (aUSDC or MockERC20)

ARBITER_AUTH_TOKEN=your_secret_token
AUDIT_SIGNING_SECRET=your_signing_secret
```

> **Mock mode:** if `CLEANVERSE_APP_ID` or `CLEANVERSE_API_KEY` is not set, the backend returns realistic fixture data so the demo runs without live credentials.

### 3. Deploy a test token (optional — for sandbox without real aUSDC)

```bash
cd contracts
npx hardhat run scripts/deploy_mock.js --network monad_testnet
# Outputs: MOCK_ATOKEN=0x...
# Set NEXT_PUBLIC_ATOKEN_ADDRESS to that address
```

### 4. Deploy the contract

```bash
cd contracts
npx hardhat compile
npx hardhat test           # all 7 tests should pass
npx hardhat run scripts/deploy.js --network monad_testnet
# Outputs: PayHub deployed: 0x...
# Update PAYHUB_CONTRACT_ADDRESS and NEXT_PUBLIC_PAYHUB_CONTRACT in .env
```

### 5. Run locally

```bash
cd frontend
npm run dev
# → http://localhost:3000
# API available at http://localhost:3000/api/*
```

The Next.js API routes handle all backend logic — no separate server needed.

---

## Deploy to Vercel

1. Push this repo to GitHub
2. Import the repo in [Vercel](https://vercel.com/new)
3. Set **Root Directory** to `frontend`
4. Add these environment variables in the Vercel dashboard:

```
CLEANVERSE_API_BASE
CLEANVERSE_APP_ID
CLEANVERSE_API_KEY
MONAD_RPC_URL
ARBITER_PRIVATE_KEY
PAYHUB_CONTRACT_ADDRESS
NEXT_PUBLIC_PAYHUB_CONTRACT
NEXT_PUBLIC_ATOKEN_ADDRESS
NEXT_PUBLIC_ARBITER_TOKEN
ARBITER_AUTH_TOKEN
AUDIT_SIGNING_SECRET
```

5. Deploy — done. Both the frontend and the API run from the same Vercel project.

---

## Monad Testnet

| Field | Value |
|-------|-------|
| Network name | Monad Testnet |
| RPC URL | `https://testnet-rpc.monad.xyz` |
| Chain ID | `10143` |
| Currency | MON |
| Explorer | `https://testnet.monad.xyz` |

---

## License

MIT
