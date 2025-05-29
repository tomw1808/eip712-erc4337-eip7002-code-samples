// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
 
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol"; // Interface for PlatformCredits with permit
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol"; // For EIP-712 signature verification
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol"; // For ecrecover
// Counters is no longer needed for simple increments in Solidity >=0.8.0
 
/**
 * @title MyNFT
 * @dev Basic ERC721 contract where NFTs can be bought using PlatformCredits (CRED).
 * Implements EIP-712 for gasless "buy NFT" action signatures.
 */
contract MyNFT is ERC721, Ownable, EIP712 {
    uint256 private _tokenIdCounter; // Start from 0, first token ID will be 1
 
    IERC20Permit public immutable paymentCredits; // Address of PlatformCredits token
    // Price in CRED tokens (e.g., 100 credits, assuming 18 decimals like the token)
    uint256 public constant NFT_PRICE_IN_CREDITS = 100 * 10**18;

    // EIP-712 typehash for the BuyNFTAction struct
    bytes32 private constant BUY_NFT_ACTION_TYPEHASH = keccak256(
        "BuyNFTAction(address user,uint256 price,uint256 nonce)"
    );
    // Nonces for the action signature to prevent replay attacks
    mapping(address => uint256) public actionNonces;
 
    event NFTMinted(address indexed buyer, uint256 indexed tokenId);
 
    constructor(address initialOwner, address _paymentCreditsAddress)
        ERC721("MyNFT", "MYNFT")
        EIP712("MyNFT", "1") // Initialize EIP712 domain separator
        Ownable(initialOwner)
    {
        require(_paymentCreditsAddress != address(0), "MyNFT: Invalid credits token address");
        paymentCredits = IERC20Permit(_paymentCreditsAddress);
    }
 
    /**
     * @dev Mints a new NFT to the caller after receiving payment in PlatformCredits.
     * Requires prior approval of PlatformCredits for this contract.
     */
    function buyNFT() public returns (uint256) {
        uint256 currentPrice = NFT_PRICE_IN_CREDITS; // Could be dynamic later
        address buyer = msg.sender;
 
        // Check allowance for PlatformCredits
        uint256 allowance = paymentCredits.allowance(buyer, address(this));
        require(allowance >= currentPrice, "MyNFT: Check credits allowance");
 
        // Transfer PlatformCredits from buyer to this contract (or owner/treasury)
        // This will fail if allowance is insufficient OR if buyer lacks balance
        bool success = paymentCredits.transferFrom(buyer, owner(), currentPrice);
        require(success, "MyNFT: Credits transfer failed");
 
        // Mint the NFT
        _tokenIdCounter++; // Increment the counter
        uint256 newTokenId = _tokenIdCounter; // Assign the new ID
        _safeMint(buyer, newTokenId);
 
        emit NFTMinted(buyer, newTokenId);
        return newTokenId;
    }
 
    // Function to withdraw collected credits (optional)
    function withdrawCredits() public onlyOwner {
        uint256 balance = paymentCredits.balanceOf(address(this));
        if (balance > 0) {
            bool success = paymentCredits.transfer(owner(), balance);
            require(success, "MyNFT: Credits withdrawal failed");
        }
    }
 
    // Later, we might add a buyNFTWithPermit function here!

    /**
     * @dev Mints a new NFT using PlatformCredits, leveraging ERC2612 permit.
     * Allows purchase without a prior separate 'approve' transaction.
     * @param deadline The permit deadline timestamp.
     * @param v The recovery byte of the permit signature.
     * @param r The r value of the permit signature.
     * @param s The s value of the permit signature.
     */
    function buyNFTWithPermit(
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public returns (uint256) {
        uint256 currentPrice = NFT_PRICE_IN_CREDITS;
        address buyer = msg.sender; // The user sending this transaction

        // Step 1: Call permit on the PlatformCredits contract
        // This grants allowance if the signature is valid
        // It will revert if the signature is invalid, expired, or already used.
        IERC20Permit(address(paymentCredits)).permit(buyer, address(this), currentPrice, deadline, v, r, s);

        // Step 2: Allowance is now set, proceed with transferFrom
        bool success = paymentCredits.transferFrom(buyer, owner(), currentPrice);
        require(success, "MyNFT: Credits transfer failed after permit");

        // Step 3: Mint the NFT
        _tokenIdCounter++; // Increment the counter
        uint256 newTokenId = _tokenIdCounter; // Assign the new ID
        _safeMint(buyer, newTokenId);

        emit NFTMinted(buyer, newTokenId);
        return newTokenId;
    }

    /**
     * @dev Mints a new NFT to a user, authorized by the user's EIP-712 signature
     * for the action and an ERC2612 permit signature for the PlatformCredits.
     * This allows a third-party relayer (msg.sender) to submit the transaction.
     * @param user The address of the user who is buying the NFT and providing signatures.
     * @param permitDeadline The deadline for the ERC2612 permit.
     * @param permitV The recovery byte of the permit signature.
     * @param permitR The r value of the permit signature.
     * @param permitS The s value of the permit signature.
     * @param actionV The recovery byte of the EIP-712 action signature.
     * @param actionR The r value of the EIP-712 action signature.
     * @param actionS The s value of the EIP-712 action signature.
     * @return The ID of the minted token.
     */
    function buyNFTWithSignatureAndPermit(
        address user,
        uint256 permitDeadline,
        uint8 permitV,
        bytes32 permitR,
        bytes32 permitS,
        uint8 actionV,
        bytes32 actionR,
        bytes32 actionS
    ) public returns (uint256) {
        uint256 currentPrice = NFT_PRICE_IN_CREDITS;
        uint256 nonce = actionNonces[user];

        // Step 1: Verify the action signature (EIP-712)
        bytes32 actionStructHash = keccak256(
            abi.encode(BUY_NFT_ACTION_TYPEHASH, user, currentPrice, nonce)
        );
        bytes32 actionDigest = _hashTypedDataV4(actionStructHash); // EIP712 helper
        
        address recoveredSigner = ECDSA.recover(actionDigest, actionV, actionR, actionS);
        require(recoveredSigner != address(0), "MyNFT: Invalid action signature (zero address)");
        require(recoveredSigner == user, "MyNFT: Action signature signer mismatch");

        // Increment nonce for replay protection of the action signature
        actionNonces[user]++;

        // Step 2: Call permit on the PlatformCredits contract (ERC2612)
        // This grants allowance to this MyNFT contract to spend 'user's credits.
        // The paymentCredits variable is already IERC20Permit.
        paymentCredits.permit(user, address(this), currentPrice, permitDeadline, permitV, permitR, permitS);

        // Step 3: Allowance is now set, proceed with transferFrom
        // Credits are transferred from 'user' to the owner of this MyNFT contract.
        bool success = paymentCredits.transferFrom(user, owner(), currentPrice);
        require(success, "MyNFT: Credits transfer failed after permit and action signature");

        // Step 4: Mint the NFT to the 'user'
        _tokenIdCounter++;
        uint256 newTokenId = _tokenIdCounter;
        _safeMint(user, newTokenId); // Mint to the 'user', not msg.sender (the relayer)

        emit NFTMinted(user, newTokenId);
        return newTokenId;
    }
}
