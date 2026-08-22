# Archived — Monad / Solidity implementation

This is the **original** PayHub contract, written in Solidity and deployed to Monad
testnet. It is **superseded** and is kept for reference and history only.

**The live implementation is [`contracts-soroban/payhub-escrow`](../../contracts-soroban/payhub-escrow)** —
Rust, on Stellar. See the root [README](../../README.md) for the current architecture.

Nothing in the active codebase imports from this directory. It is not built, not
tested in CI, and not deployed. Do not add features here.

## What changed in the move to Stellar

The Soroban version is not a port — the trust model differs. The most significant
difference is that this Solidity version gated every transfer behind a third-party
compliance API (identity verification and transfer screening). That gate has **no
Stellar equivalent and was dropped entirely, not stubbed**: the Soroban contract has
no identity-verification or transfer-screening step of any kind. See the comparison
table in the root README.

## Last deployed address

Recorded under the `monad` key in [`deployment.json`](../../deployment.json) at the
repo root. That entry is historical; the current deployment is `stellar_testnet`.
