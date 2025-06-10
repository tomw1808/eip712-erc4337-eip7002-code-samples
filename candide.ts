import * as dotenv from 'dotenv';
import {
    Simple7702Account,
    CandidePaymaster,
    MetaTransaction,
} from "abstractionkit";
// abstractionkit may rely on ethers v5.
// Ensure your project's ethers version is compatible or install v5 specifically for this.
import { http, type Hex, createPublicClient, parseEther, encodeFunctionData, type Abi, parseSignature, createWalletClient, type PublicClient, type WalletClient, toBeHex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

// --- Existing constants and ABIs from index.ts ---
// Adjust path if your directory structure for ABIs is different or if these are directly in 'out'
import platformCreditsFullJson from './contracts/out/PlatformCredits.sol/PlatformCredits.json';
import myNftFullJson from './contracts/out/MyNFT.sol/MyNFT.json';

const PRIVATE_KEY = "0x36faa8ac683b2ac54b2cb113b345107b790191014223478d786ed0c0786eedd9"; // EOA
const CANDIDE_BUNDLER_URL = "https://api.candide.dev/bundler/v3/sepolia/5bfc7f3150f9c9834d6b024261680726";
const CANDIDE_PAYMASTER_URL = "https://api.candide.dev/paymaster/v3/sepolia/5bfc7f3150f9c9834d6b024261680726";
const JSON_RPC_NODE_PROVIDER_URL = sepolia.rpcUrls.default.http[0];

const PLATFORM_CREDITS_CONTRACT_ADDRESS = '0xd000f3951141a15afb7f64c34fc7273fe39d9326' as Hex; 
const MY_NFT_CONTRACT_ADDRESS = '0x452b0ad1eed3498430ffe764256529e7ca2aebda' as Hex;
const NFT_PRICE_IN_CREDITS = parseEther('100');

const platformCreditsAbi = platformCreditsFullJson.abi as Abi;
const myNftAbi = myNftFullJson.abi as Abi;

// Viem clients
const publicClient: PublicClient = createPublicClient({
    chain: sepolia,
    transport: http(JSON_RPC_NODE_PROVIDER_URL),
});

const eoaSignerAccount: PrivateKeyAccount = privateKeyToAccount(PRIVATE_KEY as Hex);

const eoaWalletClient: WalletClient = createWalletClient({
    account: eoaSignerAccount,
    chain: sepolia,
    transport: http(JSON_RPC_NODE_PROVIDER_URL),
});

export async function runEip7702Transaction() {
    dotenv.config(); 

    const chainId = BigInt(sepolia.id);
    const eoaDelegatorPrivateKey = PRIVATE_KEY; 
    const eoaDelegatorPublicAddress = eoaSignerAccount.address;

    console.log(`EOA Delegator: ${eoaDelegatorPublicAddress}`);

    const simple7702SmartAccount = new Simple7702Account(eoaDelegatorPublicAddress);
    console.log(`Simple7702 Smart Account Address (derived by abstractionkit): ${simple7702SmartAccount.accountAddress}`);
    console.log(`(Compare this with 0xe6Cae83BdE06E4c305530e199D7217f42808555B if that was an expected address for the smart account)`);

    // --- Prepare signatures for buyNFTWithSignatureAndPermit (using viem) ---
    const permitNonce = await publicClient.readContract({
        address: PLATFORM_CREDITS_CONTRACT_ADDRESS,
        abi: platformCreditsAbi,
        functionName: 'nonces',
        args: [eoaDelegatorPublicAddress],
    });
    const actionNonce = await publicClient.readContract({
        address: MY_NFT_CONTRACT_ADDRESS,
        abi: myNftAbi,
        functionName: 'actionNonces',
        args: [eoaDelegatorPublicAddress],
    });

    const permitDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now

    const platformCreditsDomain = { name: 'PlatformCredits', version: '1', chainId: BigInt(sepolia.id), verifyingContract: PLATFORM_CREDITS_CONTRACT_ADDRESS } as const;
    const permitTypes = { Permit: [ { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ] } as const;
    const permitMessage = { owner: eoaDelegatorPublicAddress, spender: MY_NFT_CONTRACT_ADDRESS, value: NFT_PRICE_IN_CREDITS, nonce: permitNonce as bigint, deadline: permitDeadline } as const;
    
    const permitSignatureHex = await eoaWalletClient.signTypedData({ domain: platformCreditsDomain, types: permitTypes, primaryType: 'Permit', message: permitMessage });
    const parsedPermitSignature = parseSignature(permitSignatureHex);
    const permit_v = parsedPermitSignature.v; // bigint

    const myNftDomain = { name: 'MyNFT', version: '1', chainId: BigInt(sepolia.id), verifyingContract: MY_NFT_CONTRACT_ADDRESS } as const;
    const buyNftActionTypes = { BuyNFTAction: [ { name: 'user', type: 'address' }, { name: 'price', type: 'uint256' }, { name: 'nonce', type: 'uint256' } ] } as const;
    const buyNftActionMessage = { user: eoaDelegatorPublicAddress, price: NFT_PRICE_IN_CREDITS, nonce: actionNonce as bigint } as const;

    const actionSignatureHex = await eoaWalletClient.signTypedData({ domain: myNftDomain, types: buyNftActionTypes, primaryType: 'BuyNFTAction', message: buyNftActionMessage });
    const parsedActionSignature = parseSignature(actionSignatureHex);
    const action_v = parsedActionSignature.v; // bigint

    // --- Create MetaTransactions for abstractionkit ---
    const transactions: MetaTransaction[] = [
        {
            to: PLATFORM_CREDITS_CONTRACT_ADDRESS,
            value: 0n,
            data: encodeFunctionData({ abi: platformCreditsAbi, functionName: 'topUpCredits' }),
        },
        {
            to: MY_NFT_CONTRACT_ADDRESS,
            value: 0n,
            data: encodeFunctionData({
                abi: myNftAbi,
                functionName: 'buyNFTWithSignatureAndPermit',
                args: [
                    eoaDelegatorPublicAddress, 
                    permitDeadline,       
                    permit_v,             
                    parsedPermitSignature.r, 
                    parsedPermitSignature.s, 
                    action_v,             
                    parsedActionSignature.r, 
                    parsedActionSignature.s, 
                ],
            }),
        }
    ];

    // --- Create UserOperation using abstractionkit ---
    let userOperation = await simple7702SmartAccount.createUserOperation(
        transactions,
        JSON_RPC_NODE_PROVIDER_URL,
        CANDIDE_BUNDLER_URL,
        {
            eip7702Auth: { 
                chainId: chainId,
            }
        }
    );
    
    // The userOperation.eip7702Auth object is already partially populated by createUserOperation
    // with chainId, address (EOA's address), and nonce (EOA's nonce for delegation).
    // We use these to call viem's signAuthorization.

    const delegationChainId = BigInt(userOperation.eip7702Auth!.chainId!);
    const delegationAddress = userOperation.eip7702Auth!.address! as Hex; // EOA address
    const delegationNonce = BigInt(userOperation.eip7702Auth!.nonce!);

    console.log(`Signing EIP-7702 delegation for EOA ${delegationAddress} on chain ${delegationChainId} with nonce ${delegationNonce}`);

    const viemSignedAuth = await eoaWalletClient.signAuthorization({
        account: eoaSignerAccount,      // The EOA signing the delegation
        contractAddress: delegationAddress, // For this type of delegation, it's the EOA's address itself
        chainId: delegationChainId,
        nonce: delegationNonce,
    });

    // Populate the rest of the eip7702Auth object with the signature from viem
    userOperation.eip7702Auth!.yParity = toBeHex(viemSignedAuth.yParity, { size: 1 }); // Ensure 0x00 or 0x01
    userOperation.eip7702Auth!.r = viemSignedAuth.r;
    userOperation.eip7702Auth!.s = viemSignedAuth.s;
    
    console.log("EIP-7702 Delegation Authorization signed using viem.signAuthorization.");

    const paymaster = new CandidePaymaster(CANDIDE_PAYMASTER_URL);
    const sponsorshipPolicyId = process.env.SPONSORSHIP_POLICY_ID || ""; 

    let [paymasterUserOperation, ] = await paymaster.createSponsorPaymasterUserOperation(
        userOperation,
        CANDIDE_BUNDLER_URL,
        sponsorshipPolicyId
    );
    userOperation = paymasterUserOperation;

    userOperation.signature = simple7702SmartAccount.signUserOperation(
        userOperation,
        rawPrivateKeyForAbstractionKit, 
        chainId
    );

    console.log("Sending UserOperation:", JSON.stringify(userOperation, null, 2));
    let sendUserOperationResponse = await simple7702SmartAccount.sendUserOperation(
        userOperation, CANDIDE_BUNDLER_URL
    );

    console.log("UserOperation sent! Waiting for inclusion...");
    console.log("UserOp Hash:", sendUserOperationResponse.userOperationHash);

    let userOperationReceiptResult = await sendUserOperationResponse.included();

    console.log("UserOperation receipt received.");
    console.log(userOperationReceiptResult);

    if (userOperationReceiptResult.success) {
        console.log(`EIP-7702 UserOperation successful! Transaction hash: ${userOperationReceiptResult.receipt.transactionHash}`);
        const nftBalance = await publicClient.readContract({
            address: MY_NFT_CONTRACT_ADDRESS,
            abi: myNftAbi,
            functionName: 'balanceOf',
            args: [eoaDelegatorPublicAddress]
        });
        console.log(`EOA's NFT balance for ${MY_NFT_CONTRACT_ADDRESS}: ${nftBalance}`);
    } else {
        console.error("UserOperation execution failed. Reason:", userOperationReceiptResult.reason);
    }
}
