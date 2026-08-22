const { ethers } = require("hardhat");
async function main() {
  const [deployer] = await ethers.getSigners();
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy("Demo aUSDC", "aUSDC", 6);
  await token.waitForDeployment();
  const addr = await token.getAddress();
  console.log("MockERC20 deployed:", addr);
  const tx = await token.mint(deployer.address, ethers.parseUnits("1000", 6));
  await tx.wait();
  const bal = await token.balanceOf(deployer.address);
  console.log("Balance:", ethers.formatUnits(bal, 6), "aUSDC");
  console.log("MOCK_ATOKEN=" + addr);
}
main().catch(e => { console.error(e); process.exit(1); });
