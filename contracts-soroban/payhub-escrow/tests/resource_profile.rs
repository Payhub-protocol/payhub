/* Authorized Protocol Quality Assurance & Formal Verification Test Suite */
use payhub_escrow::{PayhubEscrow, PayhubEscrowClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

const DEFAULT_FINALITY_SECS: u64 = 3 * 24 * 60 * 60;
const DEFAULT_RESPONSE_WINDOW_SECS: u64 = 24 * 60 * 60;

struct ProfileHarness {
    env: Env,
    client: PayhubEscrowClient<'static>,
    payer: Address,
    merchant: Address,
    arbiter: Address,
    token_id: Address,
}

impl ProfileHarness {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(PayhubEscrow, ());
        let client = PayhubEscrowClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let fee_recipient = Address::generate(&env);
        client.initialize(&owner, &arbiter, &fee_recipient);

        let payer = Address::generate(&env);
        let merchant = Address::generate(&env);

        let admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(admin);
        let token_id = sac.address();
        token::StellarAssetClient::new(&env, &token_id).mint(&payer, &100_000_000);

        Self {
            env,
            client,
            payer,
            merchant,
            arbiter,
            token_id,
        }
    }
}

#[derive(Debug)]
struct ResourceMetric {
    name: &'static str,
    cpu_instructions: u64,
    memory_bytes: u64,
}

#[test]
fn profile_all_value_transferring_functions() {
    let mut metrics: std::vec::Vec<ResourceMetric> = std::vec::Vec::new();

    // 1. initiate_payment
    {
        let h = ProfileHarness::new();
        h.env.cost_estimate().budget().reset_unlimited();
        let cpu_before = h.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_before = h.env.cost_estimate().budget().memory_bytes_cost();

        let _id = h.client.initiate_payment(
            &h.payer,
            &h.merchant,
            &h.token_id,
            &10_000,
            &String::from_str(&h.env, "order-profile-1"),
            &0,
        );

        let cpu_after = h.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_after = h.env.cost_estimate().budget().memory_bytes_cost();

        metrics.push(ResourceMetric {
            name: "initiate_payment",
            cpu_instructions: cpu_after.saturating_sub(cpu_before),
            memory_bytes: mem_after.saturating_sub(mem_before),
        });
    }

    // 2. claim_payment
    {
        let h = ProfileHarness::new();
        let id = h.client.initiate_payment(
            &h.payer,
            &h.merchant,
            &h.token_id,
            &10_000,
            &String::from_str(&h.env, "order-profile-2"),
            &0,
        );
        h.env
            .ledger()
            .with_mut(|l| l.timestamp += DEFAULT_FINALITY_SECS + 1);

        h.env.cost_estimate().budget().reset_unlimited();
        let cpu_before = h.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_before = h.env.cost_estimate().budget().memory_bytes_cost();

        h.client.claim_payment(&id);

        let cpu_after = h.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_after = h.env.cost_estimate().budget().memory_bytes_cost();

        metrics.push(ResourceMetric {
            name: "claim_payment",
            cpu_instructions: cpu_after.saturating_sub(cpu_before),
            memory_bytes: mem_after.saturating_sub(mem_before),
        });
    }

    // 3. open_dispute
    {
        let h = ProfileHarness::new();
        let id = h.client.initiate_payment(
            &h.payer,
            &h.merchant,
            &h.token_id,
            &10_000,
            &String::from_str(&h.env, "order-profile-3"),
            &0,
        );

        h.env.cost_estimate().budget().reset_unlimited();
        let cpu_before = h.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_before = h.env.cost_estimate().budget().memory_bytes_cost();

        h.client
            .open_dispute(&id, &String::from_str(&h.env, "damaged items"));

        let cpu_after = h.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_after = h.env.cost_estimate().budget().memory_bytes_cost();

        metrics.push(ResourceMetric {
            name: "open_dispute",
            cpu_instructions: cpu_after.saturating_sub(cpu_before),
            memory_bytes: mem_after.saturating_sub(mem_before),
        });
    }

    // 4. respond_to_dispute
    {
        let h = ProfileHarness::new();
        let id = h.client.initiate_payment(
            &h.payer,
            &h.merchant,
            &h.token_id,
            &10_000,
            &String::from_str(&h.env, "order-profile-4"),
            &0,
        );
        h.client
            .open_dispute(&id, &String::from_str(&h.env, "damaged items"));

        h.env.cost_estimate().budget().reset_unlimited();
        let cpu_before = h.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_before = h.env.cost_estimate().budget().memory_bytes_cost();

        h.client.respond_to_dispute(
            &id,
            &String::from_str(&h.env, "delivery confirmation receipt"),
        );

        let cpu_after = h.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_after = h.env.cost_estimate().budget().memory_bytes_cost();

        metrics.push(ResourceMetric {
            name: "respond_to_dispute",
            cpu_instructions: cpu_after.saturating_sub(cpu_before),
            memory_bytes: mem_after.saturating_sub(mem_before),
        });
    }

    // 5. resolve_dispute
    {
        let h = ProfileHarness::new();
        let id = h.client.initiate_payment(
            &h.payer,
            &h.merchant,
            &h.token_id,
            &10_000,
            &String::from_str(&h.env, "order-profile-5"),
            &0,
        );
        h.client
            .open_dispute(&id, &String::from_str(&h.env, "damaged items"));

        h.env.cost_estimate().budget().reset_unlimited();
        let cpu_before = h.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_before = h.env.cost_estimate().budget().memory_bytes_cost();

        h.client.resolve_dispute(&h.arbiter, &id, &true);

        let cpu_after = h.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_after = h.env.cost_estimate().budget().memory_bytes_cost();

        metrics.push(ResourceMetric {
            name: "resolve_dispute",
            cpu_instructions: cpu_after.saturating_sub(cpu_before),
            memory_bytes: mem_after.saturating_sub(mem_before),
        });
    }

    // 6. auto_resolve_expired_dispute
    {
        let h = ProfileHarness::new();
        let id = h.client.initiate_payment(
            &h.payer,
            &h.merchant,
            &h.token_id,
            &10_000,
            &String::from_str(&h.env, "order-profile-6"),
            &0,
        );
        h.client
            .open_dispute(&id, &String::from_str(&h.env, "unresponsive merchant"));
        h.env
            .ledger()
            .with_mut(|l| l.timestamp += DEFAULT_RESPONSE_WINDOW_SECS + 1);

        h.env.cost_estimate().budget().reset_unlimited();
        let cpu_before = h.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_before = h.env.cost_estimate().budget().memory_bytes_cost();

        h.client.auto_resolve_expired_dispute(&id);

        let cpu_after = h.env.cost_estimate().budget().cpu_instruction_cost();
        let mem_after = h.env.cost_estimate().budget().memory_bytes_cost();

        metrics.push(ResourceMetric {
            name: "auto_resolve_expired_dispute",
            cpu_instructions: cpu_after.saturating_sub(cpu_before),
            memory_bytes: mem_after.saturating_sub(mem_before),
        });
    }

    // Print Markdown Table report
    std::println!(
        "\n=================== PAYHUB-ESCROW RESOURCE PROFILE REPORT ==================="
    );
    std::println!("| Function Entry Point             | CPU Instructions | Memory (Bytes) |");
    std::println!("| :------------------------------- | ---------------: | -------------: |");
    for m in &metrics {
        std::println!(
            "| {:<32} | {:>16} | {:>14} |",
            m.name,
            m.cpu_instructions,
            m.memory_bytes
        );
    }
    std::println!("============================================================================\n");

    // Also write report file for CI artifact export if target dir exists
    let report_content = format!(
        "# Payhub-Escrow Gas & Resource Profile Report\n\n\
        | Function Entry Point | CPU Instructions | Memory (Bytes) |\n\
        | :--- | ---: | ---: |\n\
        {}\n",
        metrics
            .iter()
            .map(|m| format!(
                "| `{}` | {} | {} |",
                m.name, m.cpu_instructions, m.memory_bytes
            ))
            .collect::<std::vec::Vec<_>>()
            .join("\n")
    );

    let _ = std::fs::write("resource_profile_report.md", &report_content);
    let _ = std::fs::write("../resource_profile_report.md", &report_content);

    assert_eq!(metrics.len(), 6);
    for m in &metrics {
        assert!(
            m.cpu_instructions > 0,
            "CPU cost should be non-zero for {}",
            m.name
        );
    }
}
