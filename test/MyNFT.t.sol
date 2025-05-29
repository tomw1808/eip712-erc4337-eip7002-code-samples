// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "src/MyNFT.sol";
import "src/PlatformCredits.sol";
import "@openzeppelin/contracts/interfaces/draft-IERC6093.sol"; // Corrected import
import "@openzeppelin/contracts/access/Ownable.sol"; // For OwnableUnauthorizedAccount error

contract MyNFTTest is Test {
    MyNFT public myNFT;
    PlatformCredits public credits;

    address owner = address(this); // Test contract itself can be the owner for deployment
    address buyer = address(0x1); // Generic buyer for simple buyNFT tests
    uint256 constant NFT_PRICE = 100 * 10**18;

    // For buyNFTWithSignatureAndPermit test
    // User who signs messages (Anvil account #3)
    uint256 constant USER_SIGNER_PRIVATE_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address userSignerAddress = vm.addr(USER_SIGNER_PRIVATE_KEY);
    // Relayer who submits the transaction (Anvil account #4)
    address relayerAddress = address(0x4);


    function setUp() public {
        // Deploy PlatformCredits first
        credits = new PlatformCredits(owner);

        // Deploy MyNFT, linking it to the PlatformCredits contract
        myNFT = new MyNFT(owner, address(credits));

        // Grant some credits to the buyer for testing
        vm.prank(owner);
        credits.grantCredits(buyer, 2 * NFT_PRICE); // Grant enough for a couple of NFTs
    }

    function testInitialState() public view {
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
        // The transferFrom will revert with ERC20InsufficientBalance from the PlatformCredits (ERC20) contract.
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, poorBuyer, NFT_PRICE / 2, NFT_PRICE));
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

    function test_RevertWhen_Constructor_InvalidCreditsAddress() public {
        vm.expectRevert("MyNFT: Invalid credits token address");
        new MyNFT(owner, address(0));
    }

    function test_RevertWhen_BuyNFT_InsufficientAllowance() public {
        uint256 insufficientAllowance = NFT_PRICE / 2;

        vm.startPrank(buyer);
        // Approve an amount less than the NFT price
        credits.approve(address(myNFT), insufficientAllowance);

        vm.expectRevert("MyNFT: Check credits allowance");
        myNFT.buyNFT();
        vm.stopPrank();
    }

    function test_WithdrawCredits_NoBalance() public {
        // Ensure MyNFT contract has no credits
        uint256 myNFTContractBalance = credits.balanceOf(address(myNFT));
        assertEq(myNFTContractBalance, 0, "MyNFT contract should initially have 0 credits for this test");

        uint256 ownerInitialBalance = credits.balanceOf(owner);

        vm.prank(owner); // Only owner of MyNFT can withdraw
        myNFT.withdrawCredits(); // Should execute without error and without transferring anything

        assertEq(credits.balanceOf(address(myNFT)), 0, "MyNFT contract balance should still be 0");
        assertEq(credits.balanceOf(owner), ownerInitialBalance, "Owner balance should not change");
    }

    function test_RevertWhen_WithdrawCredits_NotOwner() public {
        address notOwner = address(0x3);

        // Try to withdraw credits as notOwner
        vm.prank(notOwner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, notOwner));
        myNFT.withdrawCredits();
    }

    // --- Helpers for buyNFTWithSignatureAndPermit ---

    // Helper to compute the EIP-712 hash for a PlatformCredits permit
    function getPlatformCreditsPermitDigest(
        address tokenOwner,
        address spenderAddress,
        uint256 value,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes32) {
        bytes32 permitTypehash = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        bytes32 domainSeparator = credits.DOMAIN_SEPARATOR(); // Domain separator from PlatformCredits

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

    // Helper to compute the EIP-712 hash for the MyNFT BuyNFTAction
    function getBuyNFTActionDigest(
        address user,
        uint256 price,
        uint256 nonce
    ) internal view returns (bytes32) {
        // This must match the BUY_NFT_ACTION_TYPEHASH in MyNFT.sol
        bytes32 buyNFTActionTypehash = keccak256(
            "BuyNFTAction(address user,uint256 price,uint256 nonce)"
        );
        // Reconstruct the domain separator as it's internal in EIP712
        // Values must match those used in MyNFT's EIP712 constructor: EIP712("MyNFT", "1")
        bytes32 eip712DomainTypehash = keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
        bytes32 nameHash = keccak256(bytes("MyNFT"));
        bytes32 versionHash = keccak256(bytes("1"));
        bytes32 domainSeparator = keccak256(
            abi.encode(
                eip712DomainTypehash,
                nameHash,
                versionHash,
                block.chainid, // or vm.chainId() - block.chainid is fine in Foundry tests
                address(myNFT)
            )
        );

        bytes32 structHash = keccak256(
            abi.encode(
                buyNFTActionTypehash,
                user,
                price,
                nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function testBuyNFTWithSignatureAndPermit() public {
        // --- Arrange ---
        // Grant credits to the userSignerAddress
        uint256 userInitialCredits = 3 * NFT_PRICE;
        vm.prank(owner);
        credits.grantCredits(userSignerAddress, userInitialCredits);
        assertEq(credits.balanceOf(userSignerAddress), userInitialCredits, "User signer initial credits not set");

        uint256 ownerInitialCredits = credits.balanceOf(owner); // MyNFT owner

        // Permit details for PlatformCredits
        uint256 permitDeadline = block.timestamp + 1 hours;
        uint256 permitNonce = credits.nonces(userSignerAddress);

        // Action details for MyNFT
        uint256 actionNonce = myNFT.actionNonces(userSignerAddress);

        // --- Act: Signatures ---

        // 1. User signs permit for PlatformCredits (allowing MyNFT to spend NFT_PRICE)
        bytes32 permitDigest = getPlatformCreditsPermitDigest(
            userSignerAddress,          // owner of credits
            address(myNFT),             // spender (MyNFT contract)
            NFT_PRICE,                  // value
            permitNonce,                // nonce for PlatformCredits permit
            permitDeadline
        );
        (uint8 permitV, bytes32 permitR, bytes32 permitS) = vm.sign(USER_SIGNER_PRIVATE_KEY, permitDigest);

        // 2. User signs action for MyNFT (authorizing the purchase)
        bytes32 actionDigest = getBuyNFTActionDigest(
            userSignerAddress,          // user performing the action
            NFT_PRICE,                  // price of NFT
            actionNonce                 // nonce for MyNFT action
        );
        (uint8 actionV, bytes32 actionR, bytes32 actionS) = vm.sign(USER_SIGNER_PRIVATE_KEY, actionDigest);

        // --- Act: Transaction by Relayer ---
        vm.prank(relayerAddress); // Relayer submits the transaction
        uint256 tokenId = myNFT.buyNFTWithSignatureAndPermit(
            userSignerAddress,
            permitDeadline,
            permitV, permitR, permitS,
            actionV, actionR, actionS
        );

        // --- Assert ---
        assertEq(tokenId, 1, "Token ID should be 1 for the first mint via signature");
        assertEq(myNFT.ownerOf(tokenId), userSignerAddress, "User signer should own the new NFT");

        // Check credit balances
        assertEq(credits.balanceOf(userSignerAddress), userInitialCredits - NFT_PRICE, "User signer credits should decrease by NFT_PRICE");
        assertEq(credits.balanceOf(owner), ownerInitialCredits + NFT_PRICE, "MyNFT owner credits should increase by NFT_PRICE");
        assertEq(credits.balanceOf(address(myNFT)), 0, "MyNFT contract should not hold credits");


        // Check nonces
        assertEq(credits.nonces(userSignerAddress), permitNonce + 1, "PlatformCredits permit nonce should be incremented");
        assertEq(myNFT.actionNonces(userSignerAddress), actionNonce + 1, "MyNFT action nonce should be incremented");
    }
}
