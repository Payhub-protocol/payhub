import {
  Contract,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  rpc,
  nativeToScVal,
  scValToNative,
  Keypair,
  Address,
} from "@stellar/stellar-sdk";

const NETWORK_PASSPHRASE = Networks.TESTNET;
const RPC_URL = process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.PAYHUB_CONTRACT_ID || "";
const ARBITER_SECRET = process.env.ARBITER_SECRET_KEY;

function requireContractId() {
  if (!CONTRACT_ID) throw new Error("PAYHUB_CONTRACT_ID not set");
  return CONTRACT_ID;
}

function server() {
  return new rpc.Server(RPC_URL);
}

function arbiterKeypair() {
  if (!ARBITER_SECRET) throw new Error("ARBITER_SECRET_KEY not set");
  return Keypair.fromSecret(ARBITER_SECRET);
}

async function invokeAsArbiter(method, args) {
  const rpcServer = server();
  const kp = arbiterKeypair();
  const contract = new Contract(requireContractId());
  const account = await rpcServer.getAccount(kp.publicKey());

  const tx = new TransactionBuilder(account, {
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
  prepared.sign(kp);

  const sendResult = await rpcServer.sendTransaction(prepared);
  if (sendResult.status === "ERROR") {
    throw new Error(`Submission failed for ${method}: ${JSON.stringify(sendResult.errorResult)}`);
  }

  let result = await rpcServer.getTransaction(sendResult.hash);
  const start = Date.now();
  while (result.status === "NOT_FOUND" && Date.now() - start < 30_000) {
    await new Promise((r) => setTimeout(r, 1500));
    result = await rpcServer.getTransaction(sendResult.hash);
  }
  if (result.status !== "SUCCESS") {
    throw new Error(`Transaction ${sendResult.hash} ${result.status}`);
  }
  return { txHash: sendResult.hash };
}

async function readContract(method, args) {
  const rpcServer = server();
  const kp = arbiterKeypair();
  const contract = new Contract(requireContractId());
  const account = await rpcServer.getAccount(kp.publicKey());
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

export async function getPayment(id) {
  return readContract("get_payment", [nativeToScVal(id, { type: "u64" })]);
}

export async function getDispute(id) {
  return readContract("get_dispute", [nativeToScVal(id, { type: "u64" })]);
}

export async function arbiterResolve(id, inFavorOfPayer) {
  const kp = arbiterKeypair();
  return invokeAsArbiter("resolve_dispute", [
    new Address(kp.publicKey()).toScVal(),
    nativeToScVal(id, { type: "u64" }),
    nativeToScVal(inFavorOfPayer, { type: "bool" }),
  ]);
}

export async function autoResolveExpired(id) {
  return invokeAsArbiter("auto_resolve_expired_dispute", [nativeToScVal(id, { type: "u64" })]);
}
