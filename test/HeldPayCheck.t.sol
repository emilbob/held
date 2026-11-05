// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {StdPrecompiles} from "tempo-std/StdPrecompiles.sol";
import {StdTokens} from "tempo-std/StdTokens.sol";
import {ITIP20} from "tempo-std/interfaces/ITIP20.sol";
import {ITIP20RolesAuth} from "tempo-std/interfaces/ITIP20RolesAuth.sol";
import {HeldArbiter} from "../contracts/HeldArbiter.sol";
import {HeldPayCheck} from "../contracts/HeldPayCheck.sol";

interface ITIP403SetReceivePolicy {
    function setReceivePolicy(uint64 senderPolicyId, uint64 tokenFilterId, address recoveryAuthority) external;
}

/// HeldPayCheck on Tempo Foundry's local EVM with the REAL precompiles (TIP-20, TIP-403, ReceivePolicyGuard, address
/// registry). The key question for wallets that can't batch calls: when the buyer pays THROUGH this contract
/// (transferFrom), is the held payment still the buyer's (refunds and disputes), or does the contract become the payer?
contract HeldPayCheckTest is Test {
    event TransferBlocked(address indexed token, address indexed receiver, uint64 indexed blockedNonce, uint256 amount, uint8 receiptVersion, bytes receipt);

    address constant GUARD = 0xB10C000000000000000000000000000000000000;
    ITIP403SetReceivePolicy constant REG403 = ITIP403SetReceivePolicy(0x403c000000000000000000000000000000000000);
    uint64 constant ALLOW_ALL = 1;
    uint64 constant WINDOW = 7 days;

    // Same public demo merchant + salt as HeldArbiter.t.sol, so real per-order virtual addresses work.
    address constant MERCHANT = 0xeDaCEd839530f85591cC7b5db6C1d79a7e6563ed;
    bytes32 constant SALT = 0x000000000000000000000000000000000000000000000000000000013b771de3;
    bytes4 constant MASTER_ID = 0x82bfcada;

    address resolver = makeAddr("resolver");
    address buyer = makeAddr("buyer");
    address feeWallet = makeAddr("feeWallet");

    ITIP20 usd;
    HeldArbiter arbiter;
    HeldPayCheck check;
    uint64 payout;

    function setUp() public {
        vm.warp(1_790_000_000);
        usd = ITIP20(StdPrecompiles.TIP20_FACTORY.createToken("Test USD", "TUSD", "USD", StdTokens.PATH_USD, address(this), bytes32(uint256(1))));
        ITIP20RolesAuth(address(usd)).grantRole(usd.ISSUER_ROLE(), address(this));
        address[] memory tokens = new address[](1);
        tokens[0] = address(usd);
        arbiter = new HeldArbiter(MERCHANT, resolver, tokens, WINDOW, 7 days, feeWallet, 100, 0, 0);
        payout = arbiter.payoutPolicyId();
        vm.startPrank(MERCHANT);
        StdPrecompiles.ADDRESS_REGISTRY.registerVirtualMaster(SALT);
        REG403.setReceivePolicy(payout, ALLOW_ALL, address(arbiter));
        vm.stopPrank();
        check = new HeldPayCheck();
        usd.mint(buyer, 1_000e6);
    }

    function _order(uint48 id) internal pure returns (address) {
        return address(bytes20(abi.encodePacked(MASTER_ID, bytes10(0xfdfdfdfdfdfdfdfdfdfd), bytes6(id))));
    }

    function _heldReceipt() internal returns (bytes memory receipt) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++)
            if (logs[i].emitter == GUARD && logs[i].topics[0] == TransferBlocked.selector) {
                (, , receipt) = abi.decode(logs[i].data, (uint256, uint8, bytes));
                return receipt;
            }
        revert("payment was not held");
    }

    /// The merchant switches protection off: payments from anyone now go straight to the merchant.
    function _switchOff() internal {
        vm.prank(MERCHANT);
        REG403.setReceivePolicy(ALLOW_ALL, ALLOW_ALL, address(arbiter));
    }

    // ------------------------------------------------------------------ requireHeld

    function test_RequireHeld_PassesWhileProtected() public view {
        check.requireHeld(_order(1042), MERCHANT, address(arbiter), payout);
        check.requireHeld(MERCHANT, MERCHANT, address(arbiter), payout);
    }

    function test_RequireHeld_RevertsWhenSwitchedOff() public {
        _switchOff();
        vm.expectRevert(HeldPayCheck.NotHeld.selector);
        check.requireHeld(_order(1042), MERCHANT, address(arbiter), payout);
    }

    function test_RequireHeld_RevertsForAnotherArbiter() public {
        vm.expectRevert(HeldPayCheck.NotHeld.selector);
        check.requireHeld(_order(1042), MERCHANT, makeAddr("otherArbiter"), payout);
    }

    function test_RequireHeld_RevertsForAddressOfAnotherWallet() public {
        vm.expectRevert(HeldPayCheck.NotMerchantAddress.selector);
        check.requireHeld(makeAddr("notTheShop"), MERCHANT, address(arbiter), payout);
    }

    function test_SwitchedOffPaymentReallyBypasses() public {
        // The bug this contract closes: with protection off, a plain transfer is NOT held.
        _switchOff();
        uint256 before = usd.balanceOf(MERCHANT);
        vm.prank(buyer);
        usd.transfer(_order(1042), 10e6);
        assertEq(usd.balanceOf(MERCHANT), before + 10e6, "paid straight to the merchant");
    }

    // ------------------------------------------------------------------ payChecked (wallets without batching)

    function test_PayChecked_HeldAndStillTheBuyers() public {
        vm.prank(buyer);
        usd.approve(address(check), 10e6);
        vm.recordLogs();
        vm.prank(buyer);
        check.payChecked(address(usd), _order(1042), 10e6, MERCHANT, address(arbiter), payout);
        bytes memory receipt = _heldReceipt();

        HeldArbiter.Receipt memory r = arbiter.decode(receipt);
        emit log_named_address("originator", r.originator);
        assertEq(r.originator, buyer, "the held payment belongs to the buyer, not to HeldPayCheck");
        assertEq(usd.balanceOf(buyer), 990e6);

        // The buyer can still dispute, and a refund goes back to the buyer.
        vm.prank(buyer);
        arbiter.dispute(receipt);
        vm.prank(MERCHANT);
        arbiter.refund(receipt);
        assertEq(usd.balanceOf(buyer), 1_000e6, "refund reached the buyer");
        assertEq(usd.balanceOf(address(check)), 0);
    }

    function test_PayChecked_SwitchedOffMovesNothing() public {
        vm.prank(buyer);
        usd.approve(address(check), 10e6);
        _switchOff();
        vm.prank(buyer);
        vm.expectRevert(HeldPayCheck.NotHeld.selector);
        check.payChecked(address(usd), _order(1042), 10e6, MERCHANT, address(arbiter), payout);
        assertEq(usd.balanceOf(buyer), 1_000e6, "buyer keeps the money");
    }

    function test_PayChecked_OnlyMovesTheCallersOwnFunds() public {
        vm.prank(buyer);
        usd.approve(address(check), 10e6);
        // A stranger can't spend the buyer's approval: payChecked always pulls from msg.sender.
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert();
        check.payChecked(address(usd), _order(1042), 10e6, MERCHANT, address(arbiter), payout);
        assertEq(usd.balanceOf(buyer), 1_000e6);
    }
}
