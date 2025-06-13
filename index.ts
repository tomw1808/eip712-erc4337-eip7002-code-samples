import {
    Simple7702Account,
    CandidePaymaster,
    MetaTransaction,
} from "abstractionkit";
import { http, type Hex, createPublicClient, parseEther, encodeFunctionData, type Abi, createWalletClient, type PublicClient, toHex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

// ABIs
import platformCreditsFullJson from './contracts/out/PlatformCredits.sol/PlatformCredits.json';
import myNftFullJson from './contracts/out/MyNFT.sol/MyNFT.json';

const PRIVATE_KEY = "0x36faa8ac683b2ac54b2cb113b345107b790191014223478d786ed0c0786eedd9"; // EOA
const CANDIDE_BUNDLER_URL = "https://api.candide.dev/bundler/v3/sepolia/5bfc7f3150f9c9834d6b024261680726";
const CANDIDE_PAYMASTER_URL = "https://api.candide.dev/paymaster/v3/sepolia/5bfc7f3150f9c9834d6b024261680726";
// The default viem RPC for Sepolia can point to providers with strict batch request limits.
// The error "Batch of more than 3 requests are not allowed on free tier" indicates this issue.
// Switching to a more permissive public RPC node like publicnode.
const JSON_RPC_NODE_PROVIDER_URL = "https://ethereum-sepolia-rpc.publicnode.com";

const PLATFORM_CREDITS_CONTRACT_ADDRESS = '0xd000f3951141a15afb7f64c34fc7273fe39d9326' as Hex;
const MY_NFT_CONTRACT_ADDRESS = '0x452b0ad1eed3498430ffe764256529e7ca2aebda' as Hex;
const NFT_PRICE_IN_CREDITS = parseEther('100');

const platformCreditsAbi = platformCreditsFullJson.abi as Abi;
const myNftAbi = myNftFullJson.abi as Abi;

// Viem public client (can be used by abstractionkit or for reads)
const publicClient: PublicClient = createPublicClient({
    chain: sepolia,
    transport: http(JSON_RPC_NODE_PROVIDER_URL),
});

// EOA that will authorize the Simple7702Account
const eoaDelegatorAccount: PrivateKeyAccount = privateKeyToAccount(PRIVATE_KEY as Hex);

// Viem wallet client for signing EIP-7702 authorizations
const walletClient = createWalletClient({
    account: eoaDelegatorAccount,
    chain: sepolia,
    transport: http(JSON_RPC_NODE_PROVIDER_URL),
});

async function runBundledEip7702Transaction() {

    const chainId = BigInt(sepolia.id);
    const eoaDelegatorPrivateKey = PRIVATE_KEY;
    const eoaDelegatorPublicAddress = eoaDelegatorAccount.address;

    console.log(`EOA Delegator: ${eoaDelegatorPublicAddress}`);

    // Initialize Simple7702Account with the EOA's address
    const simple7702SmartAccount = new Simple7702Account(eoaDelegatorPublicAddress);
    const smartAccountAddress = simple7702SmartAccount.accountAddress;
    console.log(`Simple7702 Smart Account Address (derived by abstractionkit): ${smartAccountAddress}`);
    console.log("--- This script uses AbstractionKit to send an EIP-7702 UserOperation via ERC-4337 ---");
    console.log(`--- The Simple7702 Account (${smartAccountAddress}) will perform actions. ---`);

    // --- Define the batched transactions ---
    // 1. Smart Account tops up its own credits
    // 2. Smart Account approves MyNFT contract to spend its credits
    // 3. Smart Account buys an NFT (NFT will be owned by the Smart Account)
    const transactions: MetaTransaction[] = [
        {
            to: PLATFORM_CREDITS_CONTRACT_ADDRESS,
            value: 0n,
            data: encodeFunctionData({
                abi: platformCreditsAbi,
                functionName: 'topUpCredits',
            }),
        },
        {
            to: PLATFORM_CREDITS_CONTRACT_ADDRESS,
            value: 0n,
            data: encodeFunctionData({
                abi: platformCreditsAbi,
                functionName: 'approve',
                args: [MY_NFT_CONTRACT_ADDRESS, NFT_PRICE_IN_CREDITS],
            }),
        },
        {
            to: MY_NFT_CONTRACT_ADDRESS,
            value: 0n,
            data: encodeFunctionData({
                abi: myNftAbi,
                functionName: 'buyNFT',
            }),
        }
    ];

    console.log("Preparing UserOperation for batch: topUpCredits, approve, buyNFT");

    // --- Create UserOperation using abstractionkit ---
    let userOperation = await simple7702SmartAccount.createUserOperation(
        transactions,
        JSON_RPC_NODE_PROVIDER_URL, // For nonce and gas prices
        CANDIDE_BUNDLER_URL,      // For gas estimation
        {
            eip7702Auth: {
                chainId: chainId,
            }
        }
    );
    console.log({userOperation})

    // --- Sign EIP-7702 delegation authorization using viem ---
    // The nonce is fetched by abstractionkit's createUserOperation and is present in the userOp.
    // const authorizationNonce = userOperation.eip7702Auth!.nonce!;
    const sessionAccountNonceForAuth = await publicClient.getTransactionCount({ address: eoaDelegatorAccount.address, blockTag: 'pending' });


    console.log("Signing EIP-7702 Delegation Authorization with viem...");
    const eip7702Signature = await walletClient.signAuthorization({
        account: eoaDelegatorAccount,
        contractAddress: smartAccountAddress as Hex, // The contract being authorized
        nonce: sessionAccountNonceForAuth,
        chainId: sepolia.id,
    });

    // Replace abstractionkit's eip7702Auth object with the one signed by viem
    // The fields need to be hex strings for abstractionkit's types.
    delete eip7702Signature.v;
    userOperation.eip7702Auth = { ...eip7702Signature, chainId: toHex(chainId), nonce: toHex(sessionAccountNonceForAuth), yParity: eip7702Signature.yParity ? toHex(eip7702Signature.yParity) : "0x0" };

    console.log("EIP-7702 Delegation Authorization signed with viem.");

    // Use Candide Paymaster for sponsorship (optional)
    const paymaster = new CandidePaymaster(CANDIDE_PAYMASTER_URL);
    const sponsorshipPolicyId = process.env.SPONSORSHIP_POLICY_ID || "";

    let [paymasterUserOperation, ] = await paymaster.createSponsorPaymasterUserOperation(
        userOperation,
        CANDIDE_BUNDLER_URL,
        sponsorshipPolicyId
    );
    userOperation = paymasterUserOperation;
    console.log("Paymaster data added (if sponsorship successful).");

    // Sign the UserOperation with the EOA's key (as required by Simple7702Account)
    const rawPrivateKeyForAbstractionKit = eoaDelegatorPrivateKey.startsWith('0x')
        ? eoaDelegatorPrivateKey.substring(2)
        : eoaDelegatorPrivateKey;
    userOperation.signature = simple7702SmartAccount.signUserOperation(
        userOperation,
        rawPrivateKeyForAbstractionKit,
        chainId
    );
    console.log("UserOperation signed.");

    console.log("Sending UserOperation:", JSON.stringify(userOperation, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value, 2));

    let sendUserOperationResponse = await simple7702SmartAccount.sendUserOperation(
        userOperation, CANDIDE_BUNDLER_URL
    );

    console.log("UserOperation sent! Waiting for inclusion...");
    console.log("UserOp Hash:", sendUserOperationResponse.userOperationHash);

    let userOperationReceiptResult = await sendUserOperationResponse.included();

    console.log("UserOperation receipt received.");
    console.log(JSON.stringify(userOperationReceiptResult, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value, 2));

    if (userOperationReceiptResult.success) {
        console.log(`EIP-7702 UserOperation successful! Transaction hash: ${userOperationReceiptResult.receipt.transactionHash}`);
        // Check NFT balance of the Smart Account
        const nftBalance = await publicClient.readContract({
            address: MY_NFT_CONTRACT_ADDRESS,
            abi: myNftAbi,
            functionName: 'balanceOf',
            args: [smartAccountAddress as Hex] // Smart Account is the owner
        });
        console.log(`Simple7702 Smart Account's NFT balance for ${MY_NFT_CONTRACT_ADDRESS}: ${nftBalance}`);

        const smartAccountCredits = await publicClient.readContract({
            address: PLATFORM_CREDITS_CONTRACT_ADDRESS,
            abi: platformCreditsAbi,
            functionName: 'balanceOf',
            args: [smartAccountAddress as Hex]
        });
        console.log(`Simple7702 Smart Account's CREDITS balance: ${smartAccountCredits}`);

    } else {
        console.error("UserOperation execution failed. Reason:", userOperationReceiptResult.reason);
    }
}

async function main() {
    await runBundledEip7702Transaction();
}

main().catch((error) => {
    console.error("Error in main execution:", error);
    process.exit(1);
});
