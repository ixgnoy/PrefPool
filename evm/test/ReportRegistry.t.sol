// evm/test/ReportRegistry.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ReportRegistry, IReceiver, IERC165} from "../src/ReportRegistry.sol";

contract ReportRegistryTest is Test {
    ReportRegistry registry;
    address forwarder = address(0xF0);
    bytes32 constant CID = bytes32(uint256(0xcc));
    bytes32 constant H1 = bytes32(uint256(0xaa));
    bytes32 constant H2 = bytes32(uint256(0xbb));

    function setUp() public {
        registry = new ReportRegistry(forwarder);
    }

    function _report(bytes32 c, bytes32 h) internal pure returns (bytes memory) {
        return abi.encode(c, h);
    }

    function test_forwarderCommits() public {
        vm.prank(forwarder);
        registry.onReport("", _report(CID, H1));
        assertEq(registry.reportHash(CID), H1);
    }

    function test_rejectsNonForwarder() public {
        vm.expectRevert(abi.encodeWithSelector(ReportRegistry.UnauthorizedForwarder.selector, address(this)));
        registry.onReport("", _report(CID, H1));
    }

    function test_sameHashRetryIsNoop() public {
        vm.startPrank(forwarder);
        registry.onReport("", _report(CID, H1));
        registry.onReport("", _report(CID, H1));
        vm.stopPrank();
        assertEq(registry.reportHash(CID), H1);
    }

    function test_conflictingHashReverts() public {
        vm.startPrank(forwarder);
        registry.onReport("", _report(CID, H1));
        vm.expectRevert(abi.encodeWithSelector(ReportRegistry.ConflictingCommitment.selector, CID, H1, H2));
        registry.onReport("", _report(CID, H2));
        vm.stopPrank();
    }

    function test_emptyHashReverts() public {
        vm.prank(forwarder);
        vm.expectRevert(ReportRegistry.EmptyHash.selector);
        registry.onReport("", _report(CID, bytes32(0)));
    }

    function test_supportsInterface() public view {
        assertTrue(registry.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(registry.supportsInterface(type(IERC165).interfaceId));
        assertEq(type(IReceiver).interfaceId, bytes4(0x805f2132));
        assertFalse(registry.supportsInterface(0xffffffff));
    }
}
