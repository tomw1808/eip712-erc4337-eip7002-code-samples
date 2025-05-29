// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "src/PlatformCredits.sol";

contract PlatformCreditsTest is Test {
    PlatformCredits public credits;
    address owner = address(this); // Test contract itself can be the owner
    address user1 = address(0x1); // Used for grantCredits tests
    address spender = address(0x2); // Generic spender for permit test

    // Private key for Anvil account #2 (0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199)
    uint256 constant PERMIT_HOLDER_PRIVATE_KEY = 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a;
    address permitHolderAddress = vm.addr(PERMIT_HOLDER_PRIVATE_KEY);

    function setUp() public {
        credits = new PlatformCredits(owner);
    }

    function testInitialState() public view {
        assertEq(credits.name(), "PlatformCredits", "Name should be PlatformCredits");
        assertEq(credits.symbol(), "CRED", "Symbol should be CRED");
        assertEq(credits.owner(), owner, "Owner should be set correctly");
    }

    function testGrantCredits() public {
        uint256 grantAmount = 1000 * 10**18;
        vm.prank(owner); // Only owner can grant credits
        credits.grantCredits(user1, grantAmount);
        assertEq(credits.balanceOf(user1), grantAmount, "User1 balance should be grantAmount");
    }

    function testGrantCreditsNotOwner() public {
        uint256 grantAmount = 1000 * 10**18;
        vm.expectRevert(); // Expecting revert as user1 is not owner
        vm.prank(user1);
        credits.grantCredits(user1, grantAmount);
    }

    // Helper to compute the EIP-712 hash for a permit
    function getPermitDigest(
        address tokenOwner,
        address spenderAddress,
        uint256 value,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes32) {
        bytes32 permitTypehash = credits.PERMIT_TYPEHASH();
        bytes32 domainSeparator = credits.DOMAIN_SEPARATOR();

        bytes32 structHash = keccak256(
            abi.encode(
                permitTypehash,
                tokenOwner,
                spenderAddress,
                value,
                nonce,
                deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function testPermit() public {
        // Grant initial balance to the permitHolderAddress
        uint256 initialBalance = 1000 * 10**18;
        vm.prank(owner);
        credits.grantCredits(permitHolderAddress, initialBalance);
        assertEq(credits.balanceOf(permitHolderAddress), initialBalance, "Initial balance for permit holder not set");

        // Permit details
        uint256 permitAmount = 500 * 10**18;
        uint256 deadline = block.timestamp + 1 hours; // Permit valid for 1 hour
        uint256 nonce = credits.nonces(permitHolderAddress);

        // Get EIP-712 digest
        bytes32 digest = getPermitDigest(permitHolderAddress, spender, permitAmount, nonce, deadline);

        // Sign the digest
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PERMIT_HOLDER_PRIVATE_KEY, digest);

        // Call permit - anyone can submit a valid permit
        credits.permit(permitHolderAddress, spender, permitAmount, deadline, v, r, s);

        // Check allowance
        assertEq(credits.allowance(permitHolderAddress, spender), permitAmount, "Allowance should be set by permit");

        // Check nonce increment
        assertEq(credits.nonces(permitHolderAddress), nonce + 1, "Nonce should be incremented");

        // Test transferFrom using the permit
        address recipient = address(0x3);
        vm.startPrank(spender); // Spender executes transferFrom
        bool success = credits.transferFrom(permitHolderAddress, recipient, permitAmount);
        assertTrue(success, "transferFrom failed after permit");
        vm.stopPrank();

        assertEq(credits.balanceOf(permitHolderAddress), initialBalance - permitAmount, "Permit holder balance should decrease");
        assertEq(credits.balanceOf(recipient), permitAmount, "Recipient balance should increase after transferFrom");
        assertEq(credits.allowance(permitHolderAddress, spender), 0, "Allowance should be consumed after transferFrom");
    }
}
