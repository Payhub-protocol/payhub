#![allow(clippy::too_many_lines)]
use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::Env;

struct Setup {
    env: Env,
    client: PayhubEscrowClient<'static>,
    owner: Address,
    arbiter: Address,
    fee_recipient: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PayhubEscrow, ());
    let client = PayhubEscrowClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let fee_recipient = Address::generate(&env);
    client.initialize(&owner, &arbiter, &fee_recipient);

    Setup {
        env,
        client,
        owner,
        arbiter,
        fee_recipient,
    }
}

fn fund_token(env: &Env, payer: &Address, amount: i128) -> (Address, token::Client<'static>) {
    let admin = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(admin);
    let token_id = sac.address();
    token::StellarAssetClient::new(env, &token_id).mint(payer, &amount);
    (token_id.clone(), token::Client::new(env, &token_id))
}

#[test]
fn happy_path_claim_after_finality() {
    let s = setup();
    let payer = Address::generate(&s.env);
    let merchant = Address::generate(&s.env);
    let (token_id, token_client) = fund_token(&s.env, &payer, 1_000);

    let id = s.client.initiate_payment(
        &payer,
        &merchant,
        &token_id,
        &1_000,
        &String::from_str(&s.env, "order-1"),
        &0,
    );
    assert_eq!(id, 0);
    assert_eq!(token_client.balance(&payer), 0);

    // Finality window not elapsed yet.
    let default_finality = DEFAULT_FINALITY_SECS;
    s.env
        .ledger()
        .with_mut(|l| l.timestamp += default_finality + 1);

    s.client.claim_payment(&id);

    let payment = s.client.get_payment(&id);
    assert!(matches!(payment.status, Status::Settled));

    // 0.5% default fee, rest to merchant.
    assert_eq!(token_client.balance(&s.fee_recipient), 5);
    assert_eq!(token_client.balance(&merchant), 995);

    let _ = s.owner;
    let _ = s.arbiter;
}

#[test]
fn dispute_resolved_for_payer_refunds() {
    let s = setup();
    let payer = Address::generate(&s.env);
    let merchant = Address::generate(&s.env);
    let (token_id, token_client) = fund_token(&s.env, &payer, 500);

    let id = s.client.initiate_payment(
        &payer,
        &merchant,
        &token_id,
        &500,
        &String::from_str(&s.env, "order-2"),
        &0,
    );

    s.client
        .open_dispute(&id, &String::from_str(&s.env, "item never arrived"));

    let payment = s.client.get_payment(&id);
    assert!(matches!(payment.status, Status::Disputed));

    s.client.resolve_dispute(&s.arbiter, &id, &true);

    let payment = s.client.get_payment(&id);
    assert!(matches!(payment.status, Status::Refunded));
    assert_eq!(token_client.balance(&payer), 500);
    assert_eq!(token_client.balance(&merchant), 0);
}

#[test]
fn auto_resolve_refunds_when_merchant_silent() {
    let s = setup();
    let payer = Address::generate(&s.env);
    let merchant = Address::generate(&s.env);
    let (token_id, token_client) = fund_token(&s.env, &payer, 200);

    let id = s.client.initiate_payment(
        &payer,
        &merchant,
        &token_id,
        &200,
        &String::from_str(&s.env, "order-3"),
        &0,
    );
    s.client
        .open_dispute(&id, &String::from_str(&s.env, "not as described"));

    s.env
        .ledger()
        .with_mut(|l| l.timestamp += DEFAULT_RESPONSE_WINDOW_SECS + 1);

    s.client.auto_resolve_expired_dispute(&id);

    let payment = s.client.get_payment(&id);
    assert!(matches!(payment.status, Status::Refunded));
    assert_eq!(token_client.balance(&payer), 200);
}

#[test]
fn non_arbiter_cannot_resolve() {
    let s = setup();
    let payer = Address::generate(&s.env);
    let merchant = Address::generate(&s.env);
    let (token_id, _client) = fund_token(&s.env, &payer, 100);

    let id = s.client.initiate_payment(
        &payer,
        &merchant,
        &token_id,
        &100,
        &String::from_str(&s.env, "order-4"),
        &0,
    );
    s.client
        .open_dispute(&id, &String::from_str(&s.env, "wrong item"));

    let outsider = Address::generate(&s.env);
    let result = s.client.try_resolve_dispute(&outsider, &id, &false);
    assert_eq!(result, Err(Ok(Error::NotArbiter)));
}
