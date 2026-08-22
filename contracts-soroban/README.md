# payhub-escrow (Soroban port)

A from-scratch Rust/Soroban rewrite of [`archive/monad-solidity/PayHub.sol`](../archive/monad-solidity/PayHub.sol), targeting Stellar instead of Monad.

## What carried over
The full escrow → dispute → resolve/refund state machine: `initiate_payment`, `claim_payment`, `open_dispute`, `respond_to_dispute`, `resolve_dispute`, `auto_resolve_expired_dispute`, plus the same platform-fee split on settlement.

## What was dropped
The Cleanverse compliance gate — A-Pass identity verification and CCP/Travel-Rule screening — has no Stellar equivalent, so it isn't in this contract. `order_id` stays as a plain off-chain reference; a compliance layer can be added later without changing storage shape. `apass_payer`/`apass_merchant` fields were removed entirely rather than kept as dead fields.

## Notable design differences from the Solidity version
- **No `msg.sender`.** Soroban has no implicit caller identity — every privileged action takes an explicit `Address` argument and calls `.require_auth()` on it. `resolve_dispute` therefore takes a `caller: Address` param instead of inferring identity, and checks it against the stored owner/arbiter.
- **IDs are sequential `u64`, not `keccak256`.** Matches the pattern already used by [`tributary`](../../tributary)'s splitter contract (`split_count()`), which this scaffold follows for consistency with your other Soroban work.
- **Errors are typed (`#[contracterror]`)** rather than `require(..., "string")` reverts, with numeric codes documented on each variant, again mirroring `tributary`.

## Known gap vs. the Solidity original
`PayHub.sol` indexed every payment by payer and by merchant (`payerPayments`, `merchantPayments`, with `getPayerPayments`/`getMerchantPayments` view functions) so a wallet could list all its payments on-chain. This port does **not** carry that over yet — `get_payment(id)` requires knowing the id. Adding it back means an append-only per-address index in persistent storage, the same pattern `tributary`'s `DataKey::Created(Address)` already uses (see `contracts/splitter/src/lib.rs`); it's a reasonable next task, just not done here.

## Status
**Verified and deployed to Stellar testnet.** `cargo test` passes (4/4), the release wasm build succeeds, and the contract is live at [`CAKUPKIQ5QMIUNSJXO5Q46S54HEPFPUGS6P5A5KG72BFQOTIK6NAUVN6`](https://stellar.expert/explorer/testnet/contract/CAKUPKIQ5QMIUNSJXO5Q46S54HEPFPUGS6P5A5KG72BFQOTIK6NAUVN6), initialized with a single deployer key as owner/arbiter/fee_recipient. Contract logic has not been audited, and the frontend hasn't been wired to this deployment yet — treat it as a working, live-on-testnet first draft, not something to put real funds through.

```bash
cd contracts-soroban
cargo test
cargo build --release --target wasm32v1-none -p payhub-escrow
```

If `wasm32v1-none` isn't installed, `rustup target add wasm32v1-none` first (or copy `tributary`'s `rust-toolchain.toml`, which pins it automatically). On Windows, run these from WSL rather than natively — this repo's `cargo test` needs a working C linker, and stock Windows has none by default.

## Next steps toward a GrantFox-registerable project
1. Get `cargo test` green — I wrote 4 tests in `payhub-escrow/src/test.rs` (happy-path claim, dispute resolved for payer, auto-resolve on merchant silence, non-arbiter rejected) but they're unverified against a real compiler.
2. Add a minimal frontend/SDK (tributary's `app/` + `sdk/` are a reasonable template) so there's something to demo, same as GrantFox's own campaigns expect.
3. Deploy to Stellar testnet, same as tributary's README documents.
4. Register this as a new project at [maintainer.grantfox.xyz](https://maintainer.grantfox.xyz) — you'll be the owner/maintainer from commit one, since it's not a fork.
