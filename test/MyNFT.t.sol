// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "src/MyNFT.sol";
import "src/PlatformCredits.sol";

contract MyNFTTest is Test {
    MyNFT public myNFT;
    PlatformCredits public credits;

    address owner = address(this); // Test contract itself can be the owner for deployment
    address buyer = address(0x1);
    uint256 constant NFT_PRICE = 100 * 10**18;

    function setUp() public {
        // Deploy PlatformCredits first
        credits = new PlatformCredits(owner);

        // Deploy MyNFT, linking it to the PlatformCredits contract
        myNFT = new MyNFT(owner, address(credits));

        // Grant some credits to the buyer for testing
        vm.prank(owner);
        credits.grantCredits(buyer, 2 * NFT_PRICE); // Grant enough for a couple of NFTs
    }

    function testInitialState() public {
        assertEq(myNFT.name(), "MyNFT", "Name should be MyNFT");
        assertEq(myNFT.symbol(), "MYNFT", "Symbol should be MYNFT");
        assertEq(myNFT.owner(), owner, "Owner should be set correctly");
        assertEq(address(myNFT.paymentCredits()), address(credits), "PaymentCredits address should be correct");
        assertEq(myNFT.NFT_PRICE_IN_CREDITS(), NFT_PRICE, "NFT_PRICE_IN_CREDITS should be correct");
    }

    function testBuyNFT() public {
        // Buyer needs to approve MyNFT contract to spend their credits
        vm.startPrank(buyer);
        credits.approve(address(myNFT), NFT_PRICE);
        uint256 initialBuyerCredits = credits.balanceOf(buyer);
        uint256 initialOwnerCredits = credits.balanceOf(owner); // MyNFT transfers to its owner

        // Buyer buys an NFT
        uint256 tokenId = myNFT.buyNFT();
        vm.stopPrank();

        assertEq(tokenId, 1, "Token ID should be 1 for the first mint");
        assertEq(myNFT.ownerOf(tokenId), buyer, "Buyer should own the new NFT");
        assertEq(credits.balanceOf(buyer), initialBuyerCredits - NFT_PRICE, "Buyer's credits should decrease by NFT_PRICE");
        assertEq(credits.balanceOf(owner), initialOwnerCredits + NFT_PRICE, "Owner's credits should increase by NFT_PRICE");
    }

    function testBuyNFTNoAllowance() public {
        vm.prank(buyer);
        // No approval given
        vm.expectRevert("MyNFT: Check credits allowance");
        myNFT.buyNFT();
    }

    function testBuyNFTInsufficientCredits() public {
        address poorBuyer = address(0x2);
        // Grant insufficient credits
        vm.prank(owner);
        credits.grantCredits(poorBuyer, NFT_PRICE / 2);

        vm.startPrank(poorBuyer);
        credits.approve(address(myNFT), NFT_PRICE);
        // transferFrom will fail due to insufficient balance, which is caught by require(success, "MyNFT: Credits transfer failed");
        // or potentially by the ERC20's internal check if it reverts before returning false.
        // Foundry's default behavior for external calls that revert without a specific message is "Transaction reverted without a reason string"
        // However, our contract has a specific revert message.
        vm.expectRevert("MyNFT: Credits transfer failed");
        myNFT.buyNFT();
        vm.stopPrank();
    }

    function testWithdrawCredits() public {
        // Simulate buying an NFT to get credits into the MyNFT contract
        vm.startPrank(buyer);
        credits.approve(address(myNFT), NFT_PRICE);
        myNFT.buyNFT(); // This sends NFT_PRICE to the owner (which is `this` contract in setup)
                       // but the MyNFT contract itself holds the credits before withdrawal
        vm.stopPrank();

        // The MyNFT contract's owner is `address(this)` from setUp.
        // The credits from the sale are transferred to `myNFT.owner()`, which is `address(this)`.
        // So, the `withdrawCredits` function in `MyNFT` is designed to send credits held by `MyNFT` contract
        // to `myNFT.owner()`.
        // Let's adjust the test to reflect this. The NFT_PRICE is sent to `owner()` during `buyNFT`.
        // `withdrawCredits` is for if the MyNFT contract itself somehow received credits directly,
        // not as part of the `buyNFT` flow where it's immediately sent to `owner()`.

        // To test withdrawCredits, we need the MyNFT contract to hold credits.
        // The current buyNFT sends credits to owner(), not to address(myNFT).
        // Let's modify the MyNFT contract's buyNFT to send to address(this) (i.e., the MyNFT contract itself)
        // and then withdraw. For now, let's assume the current MyNFT contract is as is.
        // The `withdrawCredits` function will try to withdraw `paymentCredits.balanceOf(address(this))`
        // where `address(this)` is the MyNFT contract.
        // In the current `buyNFT`, credits go to `owner()`. So `balanceOf(address(myNFT))` will be 0.

        // If we want to test withdrawCredits as is, we'd need to send credits to the MyNFT contract directly.
        vm.prank(owner); // Owner of credits
        credits.transfer(address(myNFT), NFT_PRICE); // Send some credits directly to MyNFT contract

        uint256 myNFTContractBalance = credits.balanceOf(address(myNFT));
        require(myNFTContractBalance == NFT_PRICE, "MyNFT contract should have credits");

        uint256 ownerInitialBalance = credits.balanceOf(owner);

        vm.prank(owner); // Only owner of MyNFT can withdraw
        myNFT.withdrawCredits();

        assertEq(credits.balanceOf(address(myNFT)), 0, "MyNFT contract balance should be 0 after withdrawal");
        assertEq(credits.balanceOf(owner), ownerInitialBalance + myNFTContractBalance, "Owner should have received the withdrawn credits");
    }
}
