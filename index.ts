import { http, type Hex, createPublicClient, parseEther, encodeFunctionData, type Abi, parseSignature, createWalletClient, type PublicClient, type WalletClient, type SendTransactionParameters } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

// ABIs - Adjust path if your directory structure for ABIs is different
import platformCreditsFullJson from './contracts/out/PlatformCredits.sol/PlatformCredits.json';
import myNftFullJson from './contracts/out/MyNFT.sol/MyNFT.json';

const PRIVATE_KEY = "0x36faa8ac683b2ac54b2cb113b345107b790191014223478d786ed0c0786eedd9"; // EOA
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

// This WalletClient is for the EOA that will authorize and send the EIP-7702 transaction
const eoaWalletClient: WalletClient = createWalletClient({
    account: eoaSignerAccount,
    chain: sepolia,
    transport: http(JSON_RPC_NODE_PROVIDER_URL),
});

async function runViemEip7702Transaction() {
    console.log(`EOA (Signer & Transaction Sender): ${eoaSignerAccount.address}`);
    console.log(`Target MyNFT Contract: ${MY_NFT_CONTRACT_ADDRESS}`);
    console.log(`PlatformCredits Contract: ${PLATFORM_CREDITS_CONTRACT_ADDRESS}`);
    console.log("--- This script demonstrates native EIP-7702 using Viem ---");
    console.log("--- It does NOT use ERC-4337 bundlers/paymasters. ---");

    // --- Prepare EIP-2612 Permit for PlatformCredits ---
    const permitNonce = await publicClient.readContract({
        address: PLATFORM_CREDITS_CONTRACT_ADDRESS,
        abi: platformCreditsAbi,
        functionName: 'nonces',
        args: [eoaSignerAccount.address],
    });
    const permitDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

    const platformCreditsDomain = { name: 'PlatformCredits', version: '1', chainId: BigInt(sepolia.id), verifyingContract: PLATFORM_CREDITS_CONTRACT_ADDRESS } as const;
    const permitTypes = { Permit: [ { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' } ] } as const;
    const permitMessage = { owner: eoaSignerAccount.address, spender: MY_NFT_CONTRACT_ADDRESS, value: NFT_PRICE_IN_CREDITS, nonce: permitNonce as bigint, deadline: permitDeadline } as const;
    
    const permitSignatureHex = await eoaWalletClient.signTypedData({ domain: platformCreditsDomain, types: permitTypes, primaryType: 'Permit', message: permitMessage });
    const parsedPermitSignature = parseSignature(permitSignatureHex);
    // MyNFT.sol expects uint8 v (27 or 28). Viem's parseSignature.v is already this value for EIP-712.
    const permit_v = parsedPermitSignature.v; 
    console.log("Signed PlatformCredits Permit.");

    // --- Prepare EIP-712 Action Signature for MyNFT ---
    const actionNonce = await publicClient.readContract({
        address: MY_NFT_CONTRACT_ADDRESS,
        abi: myNftAbi,
        functionName: 'actionNonces',
        args: [eoaSignerAccount.address],
    });

    const myNftDomain = { name: 'MyNFT', version: '1', chainId: BigInt(sepolia.id), verifyingContract: MY_NFT_CONTRACT_ADDRESS } as const;
    const buyNftActionTypes = { BuyNFTAction: [ { name: 'user', type: 'address' }, { name: 'price', type: 'uint256' }, { name: 'nonce', type: 'uint256' } ] } as const;
    const buyNftActionMessage = { user: eoaSignerAccount.address, price: NFT_PRICE_IN_CREDITS, nonce: actionNonce as bigint } as const;

    const actionSignatureHex = await eoaWalletClient.signTypedData({ domain: myNftDomain, types: buyNftActionTypes, primaryType: 'BuyNFTAction', message: buyNftActionMessage });
    const parsedActionSignature = parseSignature(actionSignatureHex);
    const action_v = parsedActionSignature.v;
    console.log("Signed MyNFT BuyNFTAction.");

    // --- Prepare EIP-7702 Authorization ---
    // The EOA authorizes itself to act as the MyNFT contract.
    // `executor: 'self'` is used because the EOA (signer of authorization) is also sending the transaction.
    const eip7702Authorization = await eoaWalletClient.signAuthorization({
        account: eoaSignerAccount, // The EOA being "upgraded"
        contractAddress: MY_NFT_CONTRACT_ADDRESS, // The EOA will act with this contract's code
        executor: 'self', // Important: EOA signs auth AND sends tx
        // chainId, nonce can be omitted, viem infers them.
    });
    console.log("Signed EIP-7702 Authorization.");

    // --- Encode call data for buyNFTWithSignatureAndPermit ---
    const callData = encodeFunctionData({
        abi: myNftAbi,
        functionName: 'buyNFTWithSignatureAndPermit',
        args: [
            eoaSignerAccount.address,
            permitDeadline,
            Number(permit_v), // Solidity expects uint8
            parsedPermitSignature.r,
            parsedPermitSignature.s,
            Number(action_v), // Solidity expects uint8
            parsedActionSignature.r,
            parsedActionSignature.s,
        ],
    });

    // --- Send the EIP-7702 Transaction ---
    // The `to` address is the EOA itself.
    // The `authorizationList` makes this an EIP-7702 transaction (type 0x04).
    console.log(`Sending EIP-7702 transaction to EOA ${eoaSignerAccount.address} to execute MyNFT.buyNFTWithSignatureAndPermit...`);
    
    // Explicitly type txParams to include authorizationList
    const txParams: SendTransactionParameters<typeof sepolia, PrivateKeyAccount> & { authorizationList?: any[] } = {
        account: eoaSignerAccount, // The account sending the transaction
        to: eoaSignerAccount.address, // For EIP-7702, tx is sent to the EOA
        data: callData,
        authorizationList: [eip7702Authorization],
        chain: sepolia, // ensure chain is specified
        // gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas might be needed depending on network
    };

    const txHash = await eoaWalletClient.sendTransaction(txParams);
    console.log(`EIP-7702 Transaction sent. Hash: ${txHash}`);

    console.log("Waiting for transaction receipt...");
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log("Transaction Receipt:", receipt);

    if (receipt.status === 'success') {
        console.log(`EIP-7702 transaction successful! NFT should be minted to ${eoaSignerAccount.address}.`);
        const nftBalance = await publicClient.readContract({
            address: MY_NFT_CONTRACT_ADDRESS,
            abi: myNftAbi,
            functionName: 'balanceOf',
            args: [eoaSignerAccount.address]
        });
        console.log(`EOA's NFT balance for ${MY_NFT_CONTRACT_ADDRESS}: ${nftBalance}`);
    } else {
        console.error("EIP-7702 transaction failed or was reverted.");
    }

    console.log("--- Note on batching with native EIP-7702: ---");
    console.log("To batch multiple distinct calls (e.g., topUpCredits then buyNFT),");
    console.log("the EOA would typically designate a 'batcher' smart contract via EIP-7702.");
    console.log("This example focuses on a single action for clarity.");
}

async function main() {
    await runViemEip7702Transaction();
}

main().catch((error) => {
    console.error("Error in main execution:", error);
    process.exit(1);
});
