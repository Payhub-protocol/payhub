import {
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  rpc,
  nativeToScVal,
  scValToNative,
  Address,
} from "@stellar/stellar-sdk";
import * as freighter from "@stellar/freighter-api";

// ─── Network config ───────────────────────────────────────────────────────────
// NEXT_PUBLIC_PAYHUB_CONTRACT is a placeholder until payhub-escrow is deployed
// to testnet (see contracts-soroban/README.md "Status"). Every call below will
// fail with a clear "contract not deployed" error until that env var is set.
const NETWORK_PASSPHRASE = Networks.TESTNET;
const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.NEXT_PUBLIC_PAYHUB_CONTRACT || "";

function server() {
  return new rpc.Server(RPC_URL);
}

function requireContractId() {
  if (!CONTRACT_ID) {
    throw new Error(
      "NEXT_PUBLIC_PAYHUB_CONTRACT is not set. payhub-escrow has not been deployed to testnet yet " +
        "(see contracts-soroban/README.md). Set it in .env.local once you have a contract id."
    );
  }
  return CONTRACT_ID;
}

// ─── Connect via Freighter ────────────────────────────────────────────────────
export async function connectWallet() {
  const connected = await freighter.isConnected();
  if (!connected.isConnected) {
    throw new Error("Freighter not detected. Install it from freighter.app");
  }

  const accessObj = await freighter.requestAccess();
  if (accessObj.error) throw new Error(accessObj.error);

  const { address } = await freighter.getAddress();
  const net = await freighter.getNetwork();
  if (net.networkPassphrase !== NETWORK_PASSPHRASE) {
    throw new Error(
      `Freighter is on "${net.network}". Switch it to Testnet (Settings > Network) and reconnect.`
    );
  }

  return { address, walletType: "freighter" };
}

// ─── Generic contract invocation ──────────────────────────────────────────────
// Builds, simulates, signs (via Freighter), submits, and polls to completion.
async function invoke(sourcePublicKey, method, args) {
  const rpcServer = server();
  const contract = new Contract(requireContractId());
  const account = await rpcServer.getAccount(sourcePublicKey);

  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  const simulated = await rpcServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed for ${method}: ${simulated.error}`);
  }

  const prepared = rpc.assembleTransaction(tx, simulated).build();

  const signed = await freighter.signTransaction(prepared.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  if (signed.error) throw new Error(signed.error);

  const signedTx = TransactionBuilder.fromXDR(signed.signedTxXdr, NETWORK_PASSPHRASE);
  const sendResult = await rpcServer.sendTransaction(signedTx);
  if (sendResult.status === "ERROR") {
    throw new Error(`Submission failed for ${method}: ${JSON.stringify(sendResult.errorResult)}`);
  }

  return pollTransaction(rpcServer, sendResult.hash, simulated);
}

async function pollTransaction(rpcServer, hash, simulated) {
  let result = await rpcServer.getTransaction(hash);
  const start = Date.now();
  while (result.status === "NOT_FOUND" && Date.now() - start < 30_000) {
    await new Promise((r) => setTimeout(r, 1500));
    result = await rpcServer.getTransaction(hash);
  }
  if (result.status !== "SUCCESS") {
    throw new Error(`Transaction ${hash} ${result.status}`);
  }
  const returnValue = result.returnValue ? scValToNative(result.returnValue) : undefined;
  return { hash, returnValue };
}

// Read-only call: simulate against a throwaway/connected account, no signature needed.
async function read(sourcePublicKey, method, args) {
  const rpcServer = server();
  const contract = new Contract(requireContractId());
  const account = await rpcServer.getAccount(sourcePublicKey);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simulated = await rpcServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed for ${method}: ${simulated.error}`);
  }
  if (!simulated.result?.retval) return null;
  return scValToNative(simulated.result.retval);
}

// ─── payhub-escrow calls ──────────────────────────────────────────────────────
// Mirrors contracts-soroban/payhub-escrow/src/lib.rs public functions.

export async function initiatePayment(
  publicKey,
  { merchant, token, amount, orderId, customFinality = 0n }
) {
  const args = [
    new Address(publicKey).toScVal(),
    new Address(merchant).toScVal(),
    new Address(token).toScVal(),
    nativeToScVal(amount, { type: "i128" }),
    nativeToScVal(orderId, { type: "string" }),
    nativeToScVal(customFinality, { type: "u64" }),
  ];
  const { hash, returnValue } = await invoke(publicKey, "initiate_payment", args);
  return { txHash: hash, paymentId: returnValue };
}

export async function claimPayment(publicKey, id) {
  const args = [nativeToScVal(id, { type: "u64" })];
  const { hash } = await invoke(publicKey, "claim_payment", args);
  return { txHash: hash };
}

export async function openDisputeOnChain(publicKey, id, reason) {
  const args = [nativeToScVal(id, { type: "u64" }), nativeToScVal(reason, { type: "string" })];
  const { hash } = await invoke(publicKey, "open_dispute", args);
  return { txHash: hash };
}

export async function respondToDisputeOnChain(publicKey, id, evidence) {
  const args = [nativeToScVal(id, { type: "u64" }), nativeToScVal(evidence, { type: "string" })];
  const { hash } = await invoke(publicKey, "respond_to_dispute", args);
  return { txHash: hash };
}

export async function getPaymentOnChain(readerPublicKey, id) {
  const args = [nativeToScVal(id, { type: "u64" })];
  return read(readerPublicKey, "get_payment", args);
}

export async function getDisputeOnChain(readerPublicKey, id) {
  const args = [nativeToScVal(id, { type: "u64" })];
  return read(readerPublicKey, "get_dispute", args);
}
