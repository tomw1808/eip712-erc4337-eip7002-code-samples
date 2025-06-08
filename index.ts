/**
 * Based on https://github.com/wevm/viem/tree/main/examples/account-abstraction_biconomy-bundler
 */
import { http, type Hex, createPublicClient, parseEther, encodeFunctionData, type Abi, type GetBlockReturnType, parseSignature, type Signature, createWalletClient } from 'viem'
// Adjust the path based on your actual project structure and output location of ABI files
import platformCreditsFullJson from './contracts/out/PlatformCredits.sol/PlatformCredits.json';
import myNftFullJson from './contracts/out/MyNFT.sol/MyNFT.json';
import {
  createBundlerClient,
  createPaymasterClient
} from 'viem/account-abstraction'
import { toSafeSmartAccount } from "permissionless/accounts"
import { privateKeyToAccount, signTypedData } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const PRIVATE_KEY="0x36faa8ac683b2ac54b2cb113b345107b790191014223478d786ed0c0786eedd9"; // == address: 0xdead4d073eb5a47ccae500a8bc01d1f473c60aa1

const CANDIDE_BUNDLER="https://api.candide.dev/bundler/v3/sepolia/5bfc7f3150f9c9834d6b024261680726"; //hardcoded on purpose
const CANDIDE_PAYMASTER="https://api.candide.dev/paymaster/v3/sepolia/5bfc7f3150f9c9834d6b024261680726"; //paymaster sepolia hardcoded on purpose

const client = createPublicClient({
  chain: sepolia,
  transport: http(),
})

const owner = privateKeyToAccount(PRIVATE_KEY as Hex)

// Create a WalletClient for the EOA (owner) to be used for signing messages
const eoaWalletClient = createWalletClient({
  account: owner,
  chain: sepolia,
  transport: http(), // Transport is needed for a WalletClient
});

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
  paymaster: paymasterClient
})

console.log("Account: ", account.address);

// --- Contract Addresses and Constants ---
// The contracts are also verified, so you can try them yourself!
// https://sepolia.etherscan.io/address/0xd000f3951141a15afb7f64c34fc7273fe39d9326#code
// https://sepolia.etherscan.io/address/0x452b0ad1eed3498430ffe764256529e7ca2aebda#code
const PLATFORM_CREDITS_CONTRACT_ADDRESS = '0xd000f3951141a15afb7f64c34fc7273fe39d9326' as Hex; 
const MY_NFT_CONTRACT_ADDRESS = '0x452b0ad1eed3498430ffe764256529e7ca2aebda' as Hex;
const NFT_PRICE_IN_CREDITS = parseEther('100'); // Matches 100 * 10**18 in PlatformCredits and MyNFT

// --- ABIs imported from contract artifacts ---
// We cast to Abi to ensure Viem gets the expected readonly structure if needed,
// though often direct usage of .abi works if resolveJsonModule correctly infers types.
const platformCreditsAbi = platformCreditsFullJson.abi as Abi;
const myNftAbi = myNftFullJson.abi as Abi;

// Ensure the placeholder addresses are updated before running
if (PLATFORM_CREDITS_CONTRACT_ADDRESS === '0xYourPlatformCreditsContractAddressHere' || MY_NFT_CONTRACT_ADDRESS === '0xYourMyNFTContractAddressHere') {
  console.error("Please update PLATFORM_CREDITS_CONTRACT_ADDRESS and MY_NFT_CONTRACT_ADDRESS in index.ts with your deployed contract addresses.");
} else {
  console.log(`EOA (NFT Recipient & Signer): ${owner.address}`);
  console.log(`Smart Account (Relayer): ${account.address}`);
  console.log(`PlatformCredits: ${PLATFORM_CREDITS_CONTRACT_ADDRESS}, MyNFT: ${MY_NFT_CONTRACT_ADDRESS}`);

  // --- 1. Fetch current nonces for the EOA ---
  const permitNonce = await client.readContract({
    address: PLATFORM_CREDITS_CONTRACT_ADDRESS,
    abi: platformCreditsAbi,
    functionName: 'nonces',
    args: [owner.address],
  });
  console.log(`EOA's current permit nonce for PlatformCredits: ${permitNonce}`);

  const actionNonce = await client.readContract({
    address: MY_NFT_CONTRACT_ADDRESS,
    abi: myNftAbi,
    functionName: 'actionNonces',
    args: [owner.address],
  });
  console.log(`EOA's current action nonce for MyNFT: ${actionNonce}`);

  // --- 2. Prepare and sign ERC2612 Permit for PlatformCredits ---
  const permitDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now

  const platformCreditsDomain = {
    name: 'PlatformCredits', // Matches ERC20Permit constructor argument
    version: '1', // Default version for OZ ERC20Permit
    chainId: sepolia.id,
    verifyingContract: PLATFORM_CREDITS_CONTRACT_ADDRESS,
  } as const;

  const permitTypes = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  } as const;

  const permitMessage = {
    owner: owner.address as `0x${string}`,
    spender: MY_NFT_CONTRACT_ADDRESS as `0x${string}`,
    value: NFT_PRICE_IN_CREDITS,
    nonce: permitNonce as bigint,
    deadline: permitDeadline,
  } as const;

  console.log("Signing PlatformCredits Permit for EOA:", permitMessage);
  const permitSignatureHex = await eoaWalletClient.signTypedData({
    domain: platformCreditsDomain,
    types: permitTypes,
    primaryType: 'Permit',
    message: permitMessage,
  });
  const parsedPermitSignature = parseSignature(permitSignatureHex);
  const permit_v = BigInt(parsedPermitSignature.yParity + 27);
  console.log("PlatformCredits Permit Signature (r, s, yParity):", parsedPermitSignature.r, parsedPermitSignature.s, parsedPermitSignature.yParity);
  console.log("Calculated permit_v:", permit_v);


  // --- 3. Prepare and sign EIP-712 Action Signature for MyNFT ---
  // BUY_NFT_ACTION_TYPEHASH = keccak256("BuyNFTAction(address user,uint256 price,uint256 nonce)")
  const myNftDomain = {
    name: 'MyNFT', // Matches EIP712 constructor first argument in MyNFT.sol
    version: '1', // Matches EIP712 constructor second argument in MyNFT.sol
    chainId: sepolia.id,
    verifyingContract: MY_NFT_CONTRACT_ADDRESS,
  } as const;

  const buyNftActionTypes = {
    BuyNFTAction: [
      { name: 'user', type: 'address' },
      { name: 'price', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
    ],
  } as const;

  const buyNftActionMessage = {
    user: owner.address as `0x${string}`,
    price: NFT_PRICE_IN_CREDITS,
    nonce: actionNonce as bigint,
  } as const;

  console.log("Signing MyNFT BuyNFTAction for EOA:", buyNftActionMessage);
  const actionSignatureHex = await eoaWalletClient.signTypedData({
    domain: myNftDomain,
    types: buyNftActionTypes,
    primaryType: 'BuyNFTAction',
    message: buyNftActionMessage,
  });
  const parsedActionSignature = parseSignature(actionSignatureHex);
  const action_v = BigInt(parsedActionSignature.yParity + 27);
  console.log("MyNFT Action Signature (r, s, yParity):", parsedActionSignature.r, parsedActionSignature.s, parsedActionSignature.yParity);
  console.log("Calculated action_v:", action_v);

  // --- 4. Construct UserOperation calls array ---
  console.log(`Attempting UserOperation: 
    1. SmartAccount calls topUpCredits() for itself.
    2. SmartAccount transfers ${NFT_PRICE_IN_CREDITS.toString()} CRED to EOA ${owner.address}.
    3. SmartAccount calls buyNFTWithSignatureAndPermit() for EOA ${owner.address} using EOA's signatures.`);

  const userOpCalls = [
    // 1. Smart Account calls topUpCredits() for itself
    {
      to: PLATFORM_CREDITS_CONTRACT_ADDRESS,
      data: encodeFunctionData({
        abi: platformCreditsAbi,
        functionName: 'topUpCredits',
      }),
      value: 0n,
    },
    // 2. Smart Account transfers credits to the EOA
    {
      to: PLATFORM_CREDITS_CONTRACT_ADDRESS,
      data: encodeFunctionData({
        abi: platformCreditsAbi,
        functionName: 'transfer',
        args: [owner.address, NFT_PRICE_IN_CREDITS],
      }),
      value: 0n,
    },
    // 3. Smart Account calls buyNFTWithSignatureAndPermit for the EOA
    {
      to: MY_NFT_CONTRACT_ADDRESS,
      data: encodeFunctionData({
        abi: myNftAbi,
        functionName: 'buyNFTWithSignatureAndPermit',
        args: [
          owner.address,        // user (EOA)
          permitDeadline,       // permitDeadline
          permit_v,             // permitV (calculated from yParity)
          parsedPermitSignature.r, // permitR
          parsedPermitSignature.s, // permitS
          action_v,             // actionV (calculated from yParity)
          parsedActionSignature.r, // actionR
          parsedActionSignature.s, // actionS
        ],
      }),
      value: 0n,
    },
  ];

  const userOpHash = await bundlerClient.sendUserOperation({
    calls: userOpCalls,
  });
  console.log("UserOperation hash:", userOpHash);

  console.log(`Waiting for transaction receipt...`);
  const receipt = await client.waitForTransactionReceipt({ hash: userOpHash });
  console.log("Transaction Receipt:", receipt);

  if (receipt.status === 'success') {
    console.log(`NFT potentially minted! Check EOA ${owner.address} balance on an explorer.`);
    // You might want to query the NFT balance of owner.address here
    const nftBalance = await client.readContract({
        address: MY_NFT_CONTRACT_ADDRESS,
        abi: myNftAbi,
        functionName: 'balanceOf',
        args: [owner.address]
    });
    console.log(`EOA's NFT balance for ${MY_NFT_CONTRACT_ADDRESS}: ${nftBalance}`);
  } else {
    console.error("UserOperation failed or was reverted.");
  }
}
