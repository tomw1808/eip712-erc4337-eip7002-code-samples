// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
 
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
 
/**
 * @title PlatformCredits
 * @dev Basic ERC20 token representing credits on our platform.
 * Includes a function for the owner (platform) to grant credits.
 * Implements ERC2612 permit functionality.
 */
contract PlatformCredits is ERC20, ERC20Permit, Ownable {
    // Assuming 18 decimals for credits, like ETH. Adjust if needed.
    constructor(address initialOwner)
        ERC20("PlatformCredits", "CRED")
        ERC20Permit("PlatformCredits") // ERC20Permit constructor needs the token name
        Ownable(initialOwner)
    {}
 
    /**
     * @dev Grants credits to a specific address. Only callable by the owner (platform).
     * Used for simulating the initial free credits grant upon signup.
     */
    function grantCredits(address to, uint256 amount) public onlyOwner {
        _mint(to, amount); // Internally, granting credits is minting tokens
    }
}
 
