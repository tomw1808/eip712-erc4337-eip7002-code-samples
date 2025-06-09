import { runEip7702Transaction } from './candide';

async function main() {
  // Ensure the placeholder addresses are updated before running (these are now in candide.ts)
  // const PLATFORM_CREDITS_CONTRACT_ADDRESS = '0xd000f3951141a15afb7f64c34fc7273fe39d9326' as Hex; 
  // const MY_NFT_CONTRACT_ADDRESS = '0x452b0ad1eed3498430ffe764256529e7ca2aebda' as Hex;
  // if (PLATFORM_CREDITS_CONTRACT_ADDRESS === '0xYourPlatformCreditsContractAddressHere' || MY_NFT_CONTRACT_ADDRESS === '0xYourMyNFTContractAddressHere') {
  //   console.error("Please update PLATFORM_CREDITS_CONTRACT_ADDRESS and MY_NFT_CONTRACT_ADDRESS in candide.ts with your deployed contract addresses if they are placeholders.");
  // } else {
    console.log("Starting EIP-7702 transaction flow...");
    await runEip7702Transaction();
    console.log("EIP-7702 transaction flow finished.");
  // }
}

main().catch((error) => {
  console.error("Error in main execution:", error);
  process.exit(1);
});
