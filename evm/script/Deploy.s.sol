// evm/script/Deploy.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ReportRegistry} from "../src/ReportRegistry.sol";

/// forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --private-key $DEPLOYER_PK
/// FORWARDER = MockKeystoneForwarder for `cre workflow simulate --broadcast`,
///             KeystoneForwarder for a deployed workflow (see README Global Constraints).
contract Deploy is Script {
    function run() external {
        address forwarder = vm.envAddress("FORWARDER");
        vm.startBroadcast();
        ReportRegistry registry = new ReportRegistry(forwarder);
        vm.stopBroadcast();
        console.log("ReportRegistry", address(registry));
    }
}
