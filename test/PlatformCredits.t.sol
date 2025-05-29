// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "src/PlatformCredits.sol";

contract PlatformCreditsTest is Test {
    PlatformCredits public credits;
    address owner = address(this); // Test contract itself can be the owner
    address user1 = address(0x1);

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
}
