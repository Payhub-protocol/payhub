#![no_std]
//! Escrow, dispute, and refund rail for agent payments on Stellar.
//!
//! Ported from `contracts/PayHub.sol` (Monad/Solidity). The escrow, dispute,
//! and refund state machine carries over unchanged; the Cleanverse-specific
//! compliance gate (A-Pass identity verification, CCP/Travel-Rule screening)
//! does not, because no equivalent exists on Stellar. `order_id` remains as
//! a plain off-chain reference so a compliance layer can be bolted on later
//! without changing this contract's storage shape.
//!
//! Payment lifecycle:
//!   Pending  -> payer pays, funds held in the contract during the finality window
//!   Settled  -> merchant claims after the window; no dispute possible
//!   Disputed -> payer opens a dispute before the window closes
//!   Refunded -> arbiter, or an expired merchant response, resolves in the payer's favor

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contractmeta, contracttype, token,
    Address, Env, String,
};

contractmeta!(key = "name", val = "payhub-escrow");
contractmeta!(
    key = "source",
    val = "https://github.com/Payhub-protocol/payhub"
);

const DAY_LEDGERS: u32 = 17_280; // ~5s/ledger
const TTL_THRESHOLD: u32 = 30 * DAY_LEDGERS;
const TTL_EXTEND_TO: u32 = 120 * DAY_LEDGERS;

const DEFAULT_FINALITY_SECS: u64 = 3 * 24 * 60 * 60;
const DEFAULT_DISPUTE_WINDOW_SECS: u64 = 2 * 24 * 60 * 60;
const DEFAULT_RESPONSE_WINDOW_SECS: u64 = 24 * 60 * 60;
const MAX_FEE_BPS: u32 = 200; // 2%
const TOTAL_BPS: i128 = 10_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    /// Code 1. `initialize` was called a second time.
    AlreadyInitialized = 1,
    /// Code 2. `merchant` equals the payer, or is the zero-equivalent.
    InvalidMerchant = 2,
    /// Code 3. `amount` is not positive.
    InvalidAmount = 3,
    /// Code 4. The generated payment id already exists (should not happen
    /// in practice; surfaced instead of silently overwriting).
    IdCollision = 4,
    /// Code 5. No payment exists for the given id.
    PaymentNotFound = 5,
    /// Code 6. `claim_payment` called on a payment that is not `Pending`.
    NotClaimable = 6,
    /// Code 7. Caller is not the merchant on this payment.
    NotMerchant = 7,
    /// Code 8. The finality window has not elapsed yet.
    FinalityWindowActive = 8,
    /// Code 9. `open_dispute` called on a payment that is not `Pending`.
    NotDisputable = 9,
    /// Code 10. Caller is not the payer on this payment.
    NotPayer = 10,
    /// Code 11. The dispute window has closed.
    DisputeWindowClosed = 11,
    /// Code 12. `reason` or `evidence` was empty.
    EmptyText = 12,
    /// Code 13. A dispute already exists for this payment.
    DisputeAlreadyOpen = 13,
    /// Code 14. No open dispute exists for this payment.
    NoOpenDispute = 14,
    /// Code 15. The merchant response window has closed.
    ResponseWindowClosed = 15,
    /// Code 16. The merchant already responded to this dispute.
    AlreadyResponded = 16,
    /// Code 17. Caller is neither the arbiter nor the owner.
    NotArbiter = 17,
    /// Code 18. `autoResolveExpiredDispute` called while the merchant already
    /// responded, or before the response window closed.
    CannotAutoResolve = 18,
    /// Code 19. `platform_fee_bps` exceeds `MAX_FEE_BPS` (2%).
    FeeTooHigh = 19,
    /// Code 20. Caller is not the contract owner.
    NotOwner = 20,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Status {
    Pending,
    Settled,
    Disputed,
    Refunded,
}

#[contracttype]
#[derive(Clone)]
pub struct Payment {
    pub payer: Address,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    pub created_at: u64,
    pub finality_window: u64,
    pub dispute_window: u64,
    pub status: Status,
    pub order_id: String,
}

#[contracttype]
#[derive(Clone)]
pub struct Dispute {
    pub reason: String,
    pub opened_at: u64,
    pub response_deadline: u64,
    pub merchant_responded: bool,
    pub merchant_evidence: String,
    pub resolved_for: Option<Address>,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Owner,
    Arbiter,
    FeeRecipient,
    DefaultFinality,
    DefaultDisputeWindow,
    MerchantResponseWindow,
    PlatformFeeBps,
    Count,
    Payment(u64),
    Dispute(u64),
}

#[contractevent]
#[derive(Clone)]
pub struct PaymentInitiated {
    #[topic]
    pub id: u64,
    pub payer: Address,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    pub finality_deadline: u64,
}

#[contractevent]
#[derive(Clone)]
pub struct PaymentSettled {
    #[topic]
    pub id: u64,
    pub merchant: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct DisputeOpened {
    #[topic]
    pub id: u64,
    pub payer: Address,
    pub response_deadline: u64,
}

#[contractevent]
#[derive(Clone)]
pub struct MerchantResponded {
    #[topic]
    pub id: u64,
}

#[contractevent]
#[derive(Clone)]
pub struct DisputeResolved {
    #[topic]
    pub id: u64,
    pub resolved_for: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct PaymentRefunded {
    #[topic]
    pub id: u64,
    pub payer: Address,
    pub amount: i128,
}

#[contract]
pub struct PayhubEscrow;

#[contractimpl]
impl PayhubEscrow {
    /// One-time setup. Mirrors the Solidity constructor.
    pub fn initialize(
        env: Env,
        owner: Address,
        arbiter: Address,
        fee_recipient: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Owner) {
            return Err(Error::AlreadyInitialized);
        }
        owner.require_auth();

        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Arbiter, &arbiter);
        env.storage()
            .instance()
            .set(&DataKey::FeeRecipient, &fee_recipient);
        env.storage()
            .instance()
            .set(&DataKey::DefaultFinality, &DEFAULT_FINALITY_SECS);
        env.storage()
            .instance()
            .set(&DataKey::DefaultDisputeWindow, &DEFAULT_DISPUTE_WINDOW_SECS);
        env.storage().instance().set(
            &DataKey::MerchantResponseWindow,
            &DEFAULT_RESPONSE_WINDOW_SECS,
        );
        env.storage()
            .instance()
            .set(&DataKey::PlatformFeeBps, &50u32);
        env.storage().instance().set(&DataKey::Count, &0u64);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }

    /// Payer initiates a payment; funds move from payer into contract escrow.
    /// `custom_finality` of `0` uses the contract-wide default.
    pub fn initiate_payment(
        env: Env,
        payer: Address,
        merchant: Address,
        token: Address,
        amount: i128,
        order_id: String,
        custom_finality: u64,
    ) -> Result<u64, Error> {
        payer.require_auth();

        if merchant == payer {
            return Err(Error::InvalidMerchant);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let finality_window = if custom_finality > 0 {
            custom_finality
        } else {
            env.storage()
                .instance()
                .get(&DataKey::DefaultFinality)
                .unwrap_or(DEFAULT_FINALITY_SECS)
        };
        let dispute_window: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DefaultDisputeWindow)
            .unwrap_or(DEFAULT_DISPUTE_WINDOW_SECS);

        let id: u64 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        if env.storage().persistent().has(&DataKey::Payment(id)) {
            return Err(Error::IdCollision);
        }

        token::Client::new(&env, &token).transfer(&payer, env.current_contract_address(), &amount);

        let created_at = env.ledger().timestamp();
        let payment = Payment {
            payer: payer.clone(),
            merchant: merchant.clone(),
            token: token.clone(),
            amount,
            created_at,
            finality_window,
            dispute_window,
            status: Status::Pending,
            order_id,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Payment(id), &payment);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Payment(id), TTL_THRESHOLD, TTL_EXTEND_TO);
        env.storage().instance().set(&DataKey::Count, &(id + 1));

        PaymentInitiated {
            id,
            payer,
            merchant,
            token,
            amount,
            finality_deadline: created_at + finality_window,
        }
        .publish(&env);

        Ok(id)
    }

    /// Merchant claims settled funds once the finality window has elapsed.
    pub fn claim_payment(env: Env, id: u64) -> Result<(), Error> {
        let mut payment = Self::load_payment(&env, id)?;
        payment.merchant.require_auth();

        if !matches!(payment.status, Status::Pending) {
            return Err(Error::NotClaimable);
        }
        if env.ledger().timestamp() < payment.created_at + payment.finality_window {
            return Err(Error::FinalityWindowActive);
        }

        payment.status = Status::Settled;
        Self::save_payment(&env, id, &payment);
        Self::pay_out(&env, id, &payment);

        Ok(())
    }

    /// Payer opens a dispute before the dispute window closes.
    pub fn open_dispute(env: Env, id: u64, reason: String) -> Result<(), Error> {
        let mut payment = Self::load_payment(&env, id)?;
        payment.payer.require_auth();

        if !matches!(payment.status, Status::Pending) {
            return Err(Error::NotDisputable);
        }
        if env.ledger().timestamp() > payment.created_at + payment.dispute_window {
            return Err(Error::DisputeWindowClosed);
        }
        if reason.is_empty() {
            return Err(Error::EmptyText);
        }
        if env.storage().persistent().has(&DataKey::Dispute(id)) {
            return Err(Error::DisputeAlreadyOpen);
        }

        payment.status = Status::Disputed;
        Self::save_payment(&env, id, &payment);

        let response_window: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MerchantResponseWindow)
            .unwrap_or(DEFAULT_RESPONSE_WINDOW_SECS);
        let response_deadline = env.ledger().timestamp() + response_window;

        let dispute = Dispute {
            reason,
            opened_at: env.ledger().timestamp(),
            response_deadline,
            merchant_responded: false,
            merchant_evidence: String::from_str(&env, ""),
            resolved_for: None,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Dispute(id), &dispute);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Dispute(id), TTL_THRESHOLD, TTL_EXTEND_TO);

        DisputeOpened {
            id,
            payer: payment.payer,
            response_deadline,
        }
        .publish(&env);

        Ok(())
    }

    /// Merchant submits evidence within the response window.
    pub fn respond_to_dispute(env: Env, id: u64, evidence: String) -> Result<(), Error> {
        let payment = Self::load_payment(&env, id)?;
        payment.merchant.require_auth();

        if !matches!(payment.status, Status::Disputed) {
            return Err(Error::NoOpenDispute);
        }
        let mut dispute = Self::load_dispute(&env, id)?;
        if env.ledger().timestamp() > dispute.response_deadline {
            return Err(Error::ResponseWindowClosed);
        }
        if dispute.merchant_responded {
            return Err(Error::AlreadyResponded);
        }

        dispute.merchant_responded = true;
        dispute.merchant_evidence = evidence;
        env.storage()
            .persistent()
            .set(&DataKey::Dispute(id), &dispute);

        MerchantResponded { id }.publish(&env);
        Ok(())
    }

    /// Arbiter (or owner) resolves an open dispute for the payer or the merchant.
    /// `caller` must be the contract's configured arbiter or owner; Soroban has
    /// no implicit `msg.sender`, so the identity being authorized is explicit.
    pub fn resolve_dispute(
        env: Env,
        caller: Address,
        id: u64,
        in_favor_of_payer: bool,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::require_arbiter(&env, &caller)?;

        let mut payment = Self::load_payment(&env, id)?;
        if !matches!(payment.status, Status::Disputed) {
            return Err(Error::NoOpenDispute);
        }
        let mut dispute = Self::load_dispute(&env, id)?;

        let resolved_for = if in_favor_of_payer {
            payment.status = Status::Refunded;
            Self::save_payment(&env, id, &payment);
            Self::refund(&env, id, &payment);
            payment.payer.clone()
        } else {
            payment.status = Status::Settled;
            Self::save_payment(&env, id, &payment);
            Self::pay_out(&env, id, &payment);
            payment.merchant.clone()
        };

        dispute.resolved_for = Some(resolved_for.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Dispute(id), &dispute);

        DisputeResolved { id, resolved_for }.publish(&env);
        Ok(())
    }

    /// Anyone can call this to unblock the payer once the merchant misses
    /// its response deadline without a response on file.
    pub fn auto_resolve_expired_dispute(env: Env, id: u64) -> Result<(), Error> {
        let mut payment = Self::load_payment(&env, id)?;
        if !matches!(payment.status, Status::Disputed) {
            return Err(Error::NoOpenDispute);
        }
        let mut dispute = Self::load_dispute(&env, id)?;
        if dispute.merchant_responded {
            return Err(Error::CannotAutoResolve);
        }
        if env.ledger().timestamp() <= dispute.response_deadline {
            return Err(Error::CannotAutoResolve);
        }

        payment.status = Status::Refunded;
        Self::save_payment(&env, id, &payment);
        Self::refund(&env, id, &payment);

        dispute.resolved_for = Some(payment.payer.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Dispute(id), &dispute);

        DisputeResolved {
            id,
            resolved_for: payment.payer,
        }
        .publish(&env);
        Ok(())
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    pub fn get_payment(env: Env, id: u64) -> Result<Payment, Error> {
        Self::load_payment(&env, id)
    }

    pub fn get_dispute(env: Env, id: u64) -> Result<Dispute, Error> {
        Self::load_dispute(&env, id)
    }

    pub fn is_dispute_window_open(env: Env, id: u64) -> Result<bool, Error> {
        let payment = Self::load_payment(&env, id)?;
        Ok(matches!(payment.status, Status::Pending)
            && env.ledger().timestamp() <= payment.created_at + payment.dispute_window)
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    pub fn set_arbiter(env: Env, arbiter: Address) -> Result<(), Error> {
        Self::require_owner(&env)?;
        env.storage().instance().set(&DataKey::Arbiter, &arbiter);
        Ok(())
    }

    pub fn set_platform_fee(env: Env, bps: u32) -> Result<(), Error> {
        Self::require_owner(&env)?;
        if bps > MAX_FEE_BPS {
            return Err(Error::FeeTooHigh);
        }
        env.storage().instance().set(&DataKey::PlatformFeeBps, &bps);
        Ok(())
    }

    pub fn set_fee_recipient(env: Env, recipient: Address) -> Result<(), Error> {
        Self::require_owner(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::FeeRecipient, &recipient);
        Ok(())
    }

    pub fn set_default_finality(env: Env, secs: u64) -> Result<(), Error> {
        Self::require_owner(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::DefaultFinality, &secs);
        Ok(())
    }

    pub fn set_default_dispute_window(env: Env, secs: u64) -> Result<(), Error> {
        Self::require_owner(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::DefaultDisputeWindow, &secs);
        Ok(())
    }

    pub fn set_merchant_response_window(env: Env, secs: u64) -> Result<(), Error> {
        Self::require_owner(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::MerchantResponseWindow, &secs);
        Ok(())
    }

    // ─── Internal ───────────────────────────────────────────────────────────

    fn load_payment(env: &Env, id: u64) -> Result<Payment, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Payment(id))
            .ok_or(Error::PaymentNotFound)
    }

    fn save_payment(env: &Env, id: u64, payment: &Payment) {
        env.storage()
            .persistent()
            .set(&DataKey::Payment(id), payment);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Payment(id), TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    fn load_dispute(env: &Env, id: u64) -> Result<Dispute, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Dispute(id))
            .ok_or(Error::NoOpenDispute)
    }

    fn require_owner(env: &Env) -> Result<(), Error> {
        let owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(Error::NotOwner)?;
        owner.require_auth();
        Ok(())
    }

    /// Checks that `caller` (already authenticated by the caller of this fn)
    /// is either the configured arbiter or the owner.
    fn require_arbiter(env: &Env, caller: &Address) -> Result<(), Error> {
        let owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(Error::NotArbiter)?;
        let arbiter: Address = env
            .storage()
            .instance()
            .get(&DataKey::Arbiter)
            .ok_or(Error::NotArbiter)?;
        if *caller == owner || *caller == arbiter {
            Ok(())
        } else {
            Err(Error::NotArbiter)
        }
    }

    /// Pays out a `Settled` payment: platform fee to fee_recipient, remainder
    /// to the merchant.
    fn pay_out(env: &Env, id: u64, payment: &Payment) {
        let fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PlatformFeeBps)
            .unwrap_or(50);
        let fee = payment.amount * (fee_bps as i128) / TOTAL_BPS;
        let merchant_amount = payment.amount - fee;

        let client = token::Client::new(env, &payment.token);
        if fee > 0 {
            let fee_recipient: Address = env
                .storage()
                .instance()
                .get(&DataKey::FeeRecipient)
                .expect("fee recipient must be set");
            client.transfer(&env.current_contract_address(), &fee_recipient, &fee);
        }
        client.transfer(
            &env.current_contract_address(),
            &payment.merchant,
            &merchant_amount,
        );

        PaymentSettled {
            id,
            merchant: payment.merchant.clone(),
            amount: merchant_amount,
        }
        .publish(env);
    }

    /// Refunds the full escrowed amount back to the payer.
    fn refund(env: &Env, id: u64, payment: &Payment) {
        let client = token::Client::new(env, &payment.token);
        client.transfer(
            &env.current_contract_address(),
            &payment.payer,
            &payment.amount,
        );

        PaymentRefunded {
            id,
            payer: payment.payer.clone(),
            amount: payment.amount,
        }
        .publish(env);
    }
}

#[cfg(test)]
mod test;
