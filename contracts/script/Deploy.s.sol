// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import {PlatformCredits} from "../src/PlatformCredits.sol";
import {MyNFT} from "../src/MyNFT.sol";


contract Ex01DeployCreditsNft is Script {

    function run() public {
        vm.startBroadcast();

        PlatformCredits credits = new PlatformCredits(msg.sender);

        MyNFT myNFT = new MyNFT(msg.sender, address(credits));

        console.log("Deployed Credits at %s and NFT at %s",address(credits),address(myNFT));

        vm.stopBroadcast();
    }
}
