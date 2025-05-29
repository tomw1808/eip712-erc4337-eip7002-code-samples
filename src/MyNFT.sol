// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
 
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol"; // Interface for PlatformCredits
import "@openzeppelin/contracts/access/Ownable.sol";
// Counters is no longer needed for simple increments in Solidity >=0.8.0
 
/**
 * @title MyNFT
 * @dev Basic ERC721 contract where NFTs can be bought using PlatformCredits (CRED).
 */
contract MyNFT is ERC721, Ownable {
    uint256 private _tokenIdCounter; // Start from 0, first token ID will be 1
 
    IERC20 public immutable paymentCredits; // Address of PlatformCredits token
    // Price in CRED tokens (e.g., 100 credits, assuming 18 decimals like the token)
    uint256 public constant NFT_PRICE_IN_CREDITS = 100 * 10**18;
 
    event NFTMinted(address indexed buyer, uint256 indexed tokenId);
 
    constructor(address initialOwner, address _paymentCreditsAddress)
        ERC721("MyNFT", "MYNFT")
        Ownable(initialOwner)
    {
        require(_paymentCreditsAddress != address(0), "MyNFT: Invalid credits token address");
        paymentCredits = IERC20(_paymentCreditsAddress);
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
}