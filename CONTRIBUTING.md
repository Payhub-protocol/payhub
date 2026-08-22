# Contributing to PayHub

Thanks for taking the time. This page covers how to get a working setup and what we expect from changes.

PayHub has three parts, and most changes touch only one:

- `contracts-soroban/` — the Stellar/Soroban escrow contract (Rust)
- `archive/monad-solidity/` — the original Solidity contract for Monad. Superseded and archived; it is not built, tested, or deployed. Do not send changes here.
- `backend/` and `frontend/` — the Express API and Next.js app (JavaScript)

## Setup

### Soroban contract

1. Install Rust from https://rustup.rs, then add the wasm target:
   ```
   rustup target add wasm32v1-none
   ```
2. On Windows, run the commands below from WSL, not a native shell — the build needs a working C linker (`gcc`), which stock Windows doesn't ship. If `cargo test` fails with a `link.exe` or `cc not found` error, that's why.
3. Clone the repo and run the tests:
   ```
   cd contracts-soroban
   cargo test
   ```
4. To build the contract wasm:
   ```
   cargo build --release --target wasm32v1-none -p payhub-escrow
   ```

### Backend / frontend

```
npm run install:all
npm run backend:dev
npm run frontend:dev
```

## Before opening a pull request

Run the checks relevant to what you touched. CI runs the same checks and will fail otherwise:

```
# contracts-soroban/
cargo fmt --all
cargo clippy --all-targets -- -D warnings
cargo test

# backend/ or frontend/
npm run build
```

## What a good change looks like

- One concern per pull request. Small and reviewable beats big and impressive.
- New behavior comes with tests. Bug fixes come with a test that fails without the fix.
- Soroban contract code stays `no_std`, uses `require_auth()` for every privileged action, and prefers typed `#[contracterror]` codes over panics.
- Comments only where the code cannot explain itself.

## Working on an issue

If you want to work on an existing issue, comment on it first so we don't end up with duplicate work. If you found a bug or want to propose something new, open an issue before writing a large patch.

## License

By contributing, you agree that your contributions are licensed under the Apache-2.0 license that covers this project.
