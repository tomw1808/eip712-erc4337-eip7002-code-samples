/**
 * Based on https://github.com/wevm/viem/tree/main/examples/account-abstraction_biconomy-bundler
 */
import { http, type Hex, createPublicClient, parseEther, encodeFunctionData } from 'viem'
import {
  createBundlerClient,
  createPaymasterClient
} from 'viem/account-abstraction'
import { toSafeSmartAccount } from "permissionless/accounts"
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const PRIVATE_KEY="0x36faa8ac683b2ac54b2cb113b345107b790191014223478d786ed0c0786eedd9"; // == address: 0xdead4d073eb5a47ccae500a8bc01d1f473c60aa1

const CANDIDE_BUNDLER="https://api.candide.dev/bundler/v3/sepolia/5bfc7f3150f9c9834d6b024261680726"; //hardcoded on purpose
const CANDIDE_PAYMASTER="https://api.candide.dev/paymaster/v3/sepolia/5bfc7f3150f9c9834d6b024261680726"; //paymaster sepolia hardcoded on purpose

const client = createPublicClient({
  chain: sepolia,
  transport: http(),
})

const owner = privateKeyToAccount(PRIVATE_KEY as Hex)

// Generate a Safe Smart Account so you can go to safe.global and access it from there
const account = await toSafeSmartAccount({
  client,
  owners: [owner],
  version: "1.4.1"
})

const paymasterClient = createPaymasterClient({
  transport: http(
    CANDIDE_PAYMASTER,
  ),
})

const bundlerClient = createBundlerClient({
chain: sepolia,
  account,
  client,
  transport: http(
    CANDIDE_BUNDLER,
  ),
  paymaster: paymasterClient,
//   paymasterContext: {
//     mode: 'SPONSORED',
//     calculateGasLimits: true,
//     expiryDuration: 300,
//     sponsorshipInfo: {
//       webhookData: {},
//       smartAccountInfo: {
//         name: 'BICONOMY',
//         version: '2.0.0',
//       },
//     },
//   },
})

console.log("Account: ", account.address);

// --- Contract Addresses and Constants ---
// The contracts are also verified, so you can try them yourself!
// https://sepolia.etherscan.io/address/0xd000f3951141a15afb7f64c34fc7273fe39d9326#code
// https://sepolia.etherscan.io/address/0x452b0ad1eed3498430ffe764256529e7ca2aebda#code
const PLATFORM_CREDITS_CONTRACT_ADDRESS = '0xd000f3951141a15afb7f64c34fc7273fe39d9326' as Hex; 
const MY_NFT_CONTRACT_ADDRESS = '0x452b0ad1eed3498430ffe764256529e7ca2aebda' as Hex;
const NFT_PRICE_IN_CREDITS = parseEther('100'); // Matches 100 * 10**18 in PlatformCredits and MyNFT

// --- ABIs for function calls (minimal) ---
const platformCreditsAbi = [
  {
    name: 'topUpCredits',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const myNftAbi = [
  {
    name: 'buyNFT',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;


// Ensure the placeholder addresses are updated before running
if (PLATFORM_CREDITS_CONTRACT_ADDRESS === '0xYourPlatformCreditsContractAddressHere' || MY_NFT_CONTRACT_ADDRESS === '0xYourMyNFTContractAddressHere') {
  console.error("Please update PLATFORM_CREDITS_CONTRACT_ADDRESS and MY_NFT_CONTRACT_ADDRESS in js/index.ts with your deployed contract addresses.");
} else {
  console.log(`Attempting UserOperation: 1. topUpCredits, 2. approve NFT spend, 3. buyNFT`);
  console.log(`PlatformCredits: ${PLATFORM_CREDITS_CONTRACT_ADDRESS}, MyNFT: ${MY_NFT_CONTRACT_ADDRESS}`);
  console.log(`NFT Price (for approval): ${NFT_PRICE_IN_CREDITS.toString()} credits`);

  const hash = await bundlerClient.sendUserOperation({
    calls: [
      // 1. Call topUpCredits() on PlatformCredits contract
      {
        to: PLATFORM_CREDITS_CONTRACT_ADDRESS,
        data: encodeFunctionData({
          abi: platformCreditsAbi,
          functionName: 'topUpCredits',
        }),
        value: 0n, // No ETH value sent for this call
      },
      // 2. Call approve(MyNFT_ADDRESS, NFT_PRICE_IN_CREDITS) on PlatformCredits contract
      {
        to: PLATFORM_CREDITS_CONTRACT_ADDRESS,
        data: encodeFunctionData({
          abi: platformCreditsAbi,
          functionName: 'approve',
          args: [MY_NFT_CONTRACT_ADDRESS, NFT_PRICE_IN_CREDITS],
        }),
        value: 0n, // No ETH value sent for this call
      },
      // 3. Call buyNFT() on MyNFT contract
      {
        to: MY_NFT_CONTRACT_ADDRESS,
        data: encodeFunctionData({
          abi: myNftAbi,
          functionName: 'buyNFT',
        }),
        value: 0n, // No ETH value sent for this call
      },
    ],
  });
  console.log("UserOperation hash:", hash);

  console.log(`Waiting for transaction receipt...`);
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log("Transaction Receipt:", receipt);
}
