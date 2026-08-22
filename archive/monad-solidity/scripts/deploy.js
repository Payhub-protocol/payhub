const { ethers } = require("hardhat");
require("dotenv").config({ path: "../../.env" });

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // Use the same address as arbiter + fee recipient for hackathon demo
  const arbiter     = process.env.ARBITER_ADDRESS  || deployer.address;
  const feeRecipient = process.env.FEE_RECIPIENT   || deployer.address;

  const PayHub = await ethers.getContractFactory("PayHub");
  const payhub = await PayHub.deploy(arbiter, feeRecipient);
  await payhub.waitForDeployment();

  const addr = await payhub.getAddress();
  console.log("PayHub deployed:", addr);
  console.log("Network:", (await ethers.provider.getNetwork()).name);

  // Write address to file for backend to pick up
  const fs = require("fs");
  const out = { PayHub: addr, deployer: deployer.address, arbiter, feeRecipient };
  fs.writeFileSync("../deployment.json", JSON.stringify(out, null, 2));
  console.log("Saved to deployment.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
