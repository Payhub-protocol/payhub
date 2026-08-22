const { ethers } = require("hardhat");

const MOCK_ERC20   = "0x4fE3D834032E022049a1c904016C02f95A4f94A9";
const RECIPIENT    = "0x1c2B8137c0C5bf49EB03D4be3A7F8577e82bF146";
const AMOUNT       = ethers.parseUnits("1000", 6);

const ABI = [
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address) view returns (uint256)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Minting from:", signer.address);
  const token = new ethers.Contract(MOCK_ERC20, ABI, signer);
  const tx = await token.mint(RECIPIENT, AMOUNT);
  console.log("Tx sent:", tx.hash);
  await tx.wait();
  const bal = await token.balanceOf(RECIPIENT);
  console.log("New balance:", ethers.formatUnits(bal, 6), "aUSDC");
}

main().catch(e => { console.error(e); process.exit(1); });
