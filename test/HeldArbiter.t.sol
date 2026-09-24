// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {StdPrecompiles} from "tempo-std/StdPrecompiles.sol";
import {StdTokens} from "tempo-std/StdTokens.sol";
import {ITIP20} from "tempo-std/interfaces/ITIP20.sol";
import {ITIP20RolesAuth} from "tempo-std/interfaces/ITIP20RolesAuth.sol";
import {HeldArbiter} from "../contracts/HeldArbiter.sol";

interface ITIP403ReceivePolicy {
    function setReceivePolicy(uint64 senderPolicyId, uint64 tokenFilterId, address recoveryAuthority) external;
}

interface IGuard {
    function claim(address to, bytes calldata receipt) external;
    function balanceOf(bytes calldata receipt) external view returns (uint256);
}

/// Unit tests for HeldArbiter, run on Tempo Foundry's local EVM with the REAL protocol precompiles:
/// TIP-20 tokens, TIP-403 receive policies, the ReceivePolicyGuard (TIP-1028) and the address registry (TIP-1022).
/// No mocks: every held payment and every claim goes through the same precompiles as on testnet.
contract HeldArbiterTest is Test {
    event TransferBlocked(address indexed token, address indexed receiver, uint64 indexed blockedNonce, uint256 amount, uint8 receiptVersion, bytes receipt);
    event Disputed(bytes32 indexed id, address indexed originator);
    event Released(bytes32 indexed id, address indexed caller, uint256 amount);
    event Refunded(bytes32 indexed id, address indexed caller, address indexed originator, uint256 amount);

    IGuard constant GUARD = IGuard(0xB10C000000000000000000000000000000000000);
    ITIP403ReceivePolicy constant REG403 = ITIP403ReceivePolicy(0x403c000000000000000000000000000000000000);
    uint64 constant REJECT_ALL = 0;
    uint64 constant ALLOW_ALL = 1;
    uint64 constant WINDOW = 7 days;

    // The demo merchant from deployment.json. Its salt is public (revealed onchain at registration), so the tests
    // can register the same virtual master and pay real per-order virtual addresses.
    address constant MERCHANT = 0xeDaCEd839530f85591cC7b5db6C1d79a7e6563ed;
    bytes32 constant SALT = 0x000000000000000000000000000000000000000000000000000000013b771de3;
    bytes4 constant MASTER_ID = 0x82bfcada;

    address resolver = makeAddr("resolver");
    address buyer = makeAddr("buyer");
    address stranger = makeAddr("stranger");

    ITIP20 usd;   // accepted token
    ITIP20 other; // a token the merchant doesn't accept
    HeldArbiter arbiter;

    function setUp() public {
        vm.warp(1_790_000_000);
        usd = _newToken("Test USD", "TUSD", 1);
        other = _newToken("Other USD", "OUSD", 2);
        arbiter = new HeldArbiter(MERCHANT, resolver, address(usd), WINDOW);

        vm.startPrank(MERCHANT);
        StdPrecompiles.ADDRESS_REGISTRY.registerVirtualMaster(SALT);
        REG403.setReceivePolicy(REJECT_ALL, ALLOW_ALL, address(arbiter));
        vm.stopPrank();

        for (uint256 i; i < 3; i++) {
            address a = [buyer, stranger, resolver][i];
            usd.mint(a, 1_000_000e6);
            other.mint(a, 1_000_000e6);
        }
    }

    // ------------------------------------------------------------------ helpers

    function _newToken(string memory name, string memory sym, uint256 salt) internal returns (ITIP20 t) {
        t = ITIP20(StdPrecompiles.TIP20_FACTORY.createToken(name, sym, "USD", StdTokens.PATH_USD, address(this), bytes32(salt)));
        ITIP20RolesAuth(address(t)).grantRole(t.ISSUER_ROLE(), address(this));
    }

    function _orderAddress(uint48 orderId) internal pure returns (address) {
        return address(bytes20(abi.encodePacked(MASTER_ID, bytes10(0xfdfdfdfdfdfdfdfdfdfd), bytes6(orderId))));
    }

    /// Plain transfer from `from` to `to`; returns the held receipt emitted by the guard.
    function _pay(address from, address to, ITIP20 token, uint256 amount) internal returns (bytes memory receipt) {
        vm.recordLogs();
        vm.prank(from);
        token.transfer(to, amount);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(GUARD) && logs[i].topics[0] == TransferBlocked.selector) {
                (, , receipt) = abi.decode(logs[i].data, (uint256, uint8, bytes));
                return receipt;
            }
        }
        revert("payment was not held");
    }

    function _payOrder(uint256 amount) internal returns (bytes memory) {
        return _pay(buyer, _orderAddress(1042), usd, amount);
    }

    enum Fn { Release, Refund, Dispute }

    /// Typed call + expectRevert. (A low-level .call would swallow the revert expectation, so don't use one.)
    function _expectRevert(bytes4 sel, address caller, Fn fn, bytes memory r) internal {
        vm.prank(caller);
        vm.expectRevert(sel);
        if (fn == Fn.Release) arbiter.release(r);
        else if (fn == Fn.Refund) arbiter.refund(r);
        else arbiter.dispute(r);
    }

    // ------------------------------------------------------------------ holding

    function test_PaymentToOrderAddressIsHeld() public {
        uint256 before = usd.balanceOf(MERCHANT);
        bytes memory r = _payOrder(20e6);
        assertEq(usd.balanceOf(MERCHANT), before, "merchant must not receive held funds");
        assertEq(GUARD.balanceOf(r), 20e6, "guard holds the payment");

        HeldArbiter.Receipt memory d = arbiter.decode(r);
        assertEq(d.recoveryAuthority, address(arbiter));
        assertEq(d.originator, buyer);
        assertEq(d.recipient, _orderAddress(1042), "recipient is the per-order virtual address");
        assertEq(d.token, address(usd));
        assertEq(uint256(uint48(bytes6(bytes20(d.recipient) << 112))), 1042, "order id = userTag");
        assertEq(arbiter.windowEndsAt(r), d.blockedAt + WINDOW);
    }

    function test_PaymentToMasterAddressIsHeld() public {
        bytes memory r = _pay(buyer, MERCHANT, usd, 5e6);
        assertEq(GUARD.balanceOf(r), 5e6);
    }

    // ------------------------------------------------------------------ release

    function test_BuyerConfirmsDelivery_ReleasesToMerchant() public {
        bytes memory r = _payOrder(20e6);
        uint256 before = usd.balanceOf(MERCHANT);
        vm.expectEmit(true, true, false, true, address(arbiter));
        emit Released(keccak256(r), buyer, 20e6);
        vm.prank(buyer);
        arbiter.release(r);
        assertEq(usd.balanceOf(MERCHANT) - before, 20e6);
        assertEq(GUARD.balanceOf(r), 0);
        assertEq(uint8(arbiter.statusOf(keccak256(r))), uint8(HeldArbiter.Status.Released));
    }

    function test_MerchantCannotReleaseBeforeWindow() public {
        bytes memory r = _payOrder(20e6);
        _expectRevert(HeldArbiter.NotAllowed.selector, MERCHANT, Fn.Release, r);
    }

    function test_StrangerCannotReleaseBeforeWindow() public {
        bytes memory r = _payOrder(20e6);
        _expectRevert(HeldArbiter.NotAllowed.selector, stranger, Fn.Release, r);
    }

    function test_ResolverCannotReleaseUndisputed() public {
        bytes memory r = _payOrder(20e6);
        _expectRevert(HeldArbiter.NotAllowed.selector, resolver, Fn.Release, r);
    }

    function test_AnyoneCanReleaseAfterWindow() public {
        bytes memory r = _payOrder(5e6);
        vm.warp(block.timestamp + WINDOW);
        uint256 before = usd.balanceOf(MERCHANT);
        vm.prank(stranger);
        arbiter.release(r);
        assertEq(usd.balanceOf(MERCHANT) - before, 5e6);
    }

    function test_CannotReleaseTwice() public {
        bytes memory r = _payOrder(20e6);
        vm.prank(buyer);
        arbiter.release(r);
        _expectRevert(HeldArbiter.AlreadySettled.selector, buyer, Fn.Release, r);
    }

    function test_CannotRefundAfterRelease() public {
        bytes memory r = _payOrder(20e6);
        vm.prank(buyer);
        arbiter.release(r);
        _expectRevert(HeldArbiter.AlreadySettled.selector, MERCHANT, Fn.Refund, r);
    }

    // ------------------------------------------------------------------ dispute

    function test_BuyerDispute_ResolverRefundsToOriginator() public {
        bytes memory r = _payOrder(15e6);
        vm.expectEmit(true, true, false, false, address(arbiter));
        emit Disputed(keccak256(r), buyer);
        vm.prank(buyer);
        arbiter.dispute(r);

        uint256 before = usd.balanceOf(buyer);
        vm.expectEmit(true, true, true, true, address(arbiter));
        emit Refunded(keccak256(r), resolver, buyer, 15e6);
        vm.prank(resolver);
        arbiter.refund(r);
        assertEq(usd.balanceOf(buyer) - before, 15e6);
        assertEq(uint8(arbiter.statusOf(keccak256(r))), uint8(HeldArbiter.Status.Refunded));
    }

    function test_BuyerDispute_ResolverReleasesToMerchant() public {
        bytes memory r = _payOrder(15e6);
        vm.prank(buyer);
        arbiter.dispute(r);
        uint256 before = usd.balanceOf(MERCHANT);
        vm.prank(resolver);
        arbiter.release(r);
        assertEq(usd.balanceOf(MERCHANT) - before, 15e6);
    }

    function test_OnlyOriginatorCanDispute() public {
        bytes memory r = _payOrder(15e6);
        _expectRevert(HeldArbiter.NotOriginator.selector, stranger, Fn.Dispute, r);
        _expectRevert(HeldArbiter.NotOriginator.selector, MERCHANT, Fn.Dispute, r);
        _expectRevert(HeldArbiter.NotOriginator.selector, resolver, Fn.Dispute, r);
    }

    function test_CannotDisputeTwice() public {
        bytes memory r = _payOrder(15e6);
        vm.prank(buyer);
        arbiter.dispute(r);
        _expectRevert(HeldArbiter.AlreadyDisputed.selector, buyer, Fn.Dispute, r);
    }

    function test_CannotDisputeAfterWindow() public {
        bytes memory r = _payOrder(15e6);
        vm.warp(block.timestamp + WINDOW);
        _expectRevert(HeldArbiter.WindowClosed.selector, buyer, Fn.Dispute, r);
    }

    function test_CannotDisputeSettledPayment() public {
        bytes memory r = _payOrder(15e6);
        vm.prank(buyer);
        arbiter.release(r);
        _expectRevert(HeldArbiter.AlreadySettled.selector, buyer, Fn.Dispute, r);
    }

    function test_DisputeFreezesRelease_EvenAfterWindow() public {
        bytes memory r = _payOrder(15e6);
        vm.prank(buyer);
        arbiter.dispute(r);
        _expectRevert(HeldArbiter.NotAllowed.selector, buyer, Fn.Release, r);
        _expectRevert(HeldArbiter.NotAllowed.selector, MERCHANT, Fn.Release, r);
        vm.warp(block.timestamp + WINDOW + 30 days);
        _expectRevert(HeldArbiter.NotAllowed.selector, stranger, Fn.Release, r);
        _expectRevert(HeldArbiter.NotAllowed.selector, MERCHANT, Fn.Release, r);
    }

    function test_ResolverCannotRefundWithoutDispute() public {
        bytes memory r = _payOrder(15e6);
        _expectRevert(HeldArbiter.NotAllowed.selector, resolver, Fn.Refund, r);
    }

    function test_OneDecisionPerDispute() public {
        bytes memory r = _payOrder(15e6);
        vm.prank(buyer);
        arbiter.dispute(r);
        vm.prank(resolver);
        arbiter.refund(r);
        _expectRevert(HeldArbiter.AlreadySettled.selector, resolver, Fn.Release, r);
        _expectRevert(HeldArbiter.AlreadySettled.selector, resolver, Fn.Refund, r);
    }

    // ------------------------------------------------------------------ refunds

    function test_MerchantVoluntaryRefund() public {
        bytes memory r = _payOrder(3e6);
        uint256 before = usd.balanceOf(buyer);
        vm.prank(MERCHANT);
        arbiter.refund(r);
        assertEq(usd.balanceOf(buyer) - before, 3e6);
    }

    function test_MerchantCanRefundDisputedPayment() public {
        bytes memory r = _payOrder(3e6);
        vm.prank(buyer);
        arbiter.dispute(r);
        vm.prank(MERCHANT);
        arbiter.refund(r);
        assertEq(uint8(arbiter.statusOf(keccak256(r))), uint8(HeldArbiter.Status.Refunded));
    }

    function test_BuyerCannotSelfRefundAcceptedToken() public {
        bytes memory r = _payOrder(3e6);
        _expectRevert(HeldArbiter.NotAllowed.selector, buyer, Fn.Refund, r);
    }

    function test_StrangerCannotRefund() public {
        bytes memory r = _payOrder(3e6);
        _expectRevert(HeldArbiter.NotAllowed.selector, stranger, Fn.Refund, r);
    }

    function test_WrongToken_PayerCanSelfRefund() public {
        bytes memory r = _pay(buyer, _orderAddress(1043), other, 7e6);
        uint256 before = other.balanceOf(buyer);
        vm.prank(buyer);
        arbiter.refund(r);
        assertEq(other.balanceOf(buyer) - before, 7e6);
    }

    function test_WrongToken_StrangerCannotRefund() public {
        bytes memory r = _pay(buyer, _orderAddress(1043), other, 7e6);
        _expectRevert(HeldArbiter.NotAllowed.selector, stranger, Fn.Refund, r);
    }

    function test_WrongToken_RefundAlwaysGoesToOriginator() public {
        // Even when the merchant triggers it, the refund goes to the payer, never to the caller.
        bytes memory r = _pay(buyer, _orderAddress(1043), other, 7e6);
        uint256 before = other.balanceOf(buyer);
        uint256 mBefore = other.balanceOf(MERCHANT);
        vm.prank(MERCHANT);
        arbiter.refund(r);
        assertEq(other.balanceOf(buyer) - before, 7e6);
        assertEq(other.balanceOf(MERCHANT), mBefore);
    }

    // ------------------------------------------------------------------ nobody bypasses the arbiter

    function test_NoWalletCanClaimFromGuardDirectly() public {
        bytes memory r = _payOrder(5e6);
        address[4] memory who = [buyer, MERCHANT, resolver, stranger];
        for (uint256 i; i < who.length; i++) {
            vm.prank(who[i]);
            vm.expectRevert();
            GUARD.claim(who[i], r);
        }
        assertEq(GUARD.balanceOf(r), 5e6, "funds still held");
    }

    function test_TamperedReceiptCannotRedirectRefund() public {
        // Rewrite the originator to a stranger: the guard must reject the forged receipt, so a refund can't be
        // redirected to someone who didn't pay.
        bytes memory r = _payOrder(5e6);
        HeldArbiter.Receipt memory d = arbiter.decode(r);
        d.originator = stranger;
        bytes memory forged = abi.encode(d);
        vm.prank(MERCHANT);
        vm.expectRevert();
        arbiter.refund(forged);
        assertEq(GUARD.balanceOf(r), 5e6, "real receipt untouched");
    }

    function test_RejectsReceiptForOtherAuthority() public {
        // A payment held under a different recovery authority is not this arbiter's business.
        address otherMerchant = makeAddr("otherMerchant");
        vm.prank(otherMerchant);
        REG403.setReceivePolicy(REJECT_ALL, ALLOW_ALL, stranger);
        bytes memory r = _pay(buyer, otherMerchant, usd, 5e6);
        _expectRevert(HeldArbiter.NotOurReceipt.selector, buyer, Fn.Release, r);
    }

    function test_RejectsReceiptForOtherMerchant() public {
        // Another merchant naming this arbiter as their authority can't make it pay them.
        address otherMerchant = makeAddr("otherMerchant");
        vm.prank(otherMerchant);
        REG403.setReceivePolicy(REJECT_ALL, ALLOW_ALL, address(arbiter));
        bytes memory r = _pay(buyer, otherMerchant, usd, 5e6);
        _expectRevert(HeldArbiter.NotForMerchant.selector, buyer, Fn.Release, r);
        _expectRevert(HeldArbiter.NotForMerchant.selector, otherMerchant, Fn.Refund, r);
    }

    // ------------------------------------------------------------------ fuzz

    /// Any amount: release pays the merchant exactly that amount, refund returns exactly that amount.
    function testFuzz_ReleaseAndRefundMoveExactAmount(uint256 amount, bool doRelease) public {
        amount = bound(amount, 1, 1_000_000e6);
        bytes memory r = _payOrder(amount);
        if (doRelease) {
            uint256 before = usd.balanceOf(MERCHANT);
            vm.prank(buyer);
            arbiter.release(r);
            assertEq(usd.balanceOf(MERCHANT) - before, amount);
        } else {
            uint256 before = usd.balanceOf(buyer);
            vm.prank(MERCHANT);
            arbiter.refund(r);
            assertEq(usd.balanceOf(buyer) - before, amount);
        }
        assertEq(GUARD.balanceOf(r), 0);
    }

    /// Window boundary: dispute works strictly before the end; permissionless release works from the end on.
    function testFuzz_WindowBoundary(uint64 elapsed) public {
        elapsed = uint64(bound(elapsed, 0, 2 * uint256(WINDOW)));
        bytes memory r = _payOrder(10e6);
        vm.warp(block.timestamp + elapsed);
        if (elapsed < WINDOW) {
            _expectRevert(HeldArbiter.NotAllowed.selector, stranger, Fn.Release, r);
            vm.prank(buyer);
            arbiter.dispute(r);
        } else {
            _expectRevert(HeldArbiter.WindowClosed.selector, buyer, Fn.Dispute, r);
            vm.prank(stranger);
            arbiter.release(r);
        }
    }

    /// Any caller that isn't the buyer, merchant or resolver can do nothing inside the window.
    function testFuzz_RandomCallerPowerless(address caller) public {
        vm.assume(caller != buyer && caller != MERCHANT && caller != resolver && caller != address(0));
        bytes memory r = _payOrder(10e6);
        _expectRevert(HeldArbiter.NotAllowed.selector, caller, Fn.Release, r);
        _expectRevert(HeldArbiter.NotAllowed.selector, caller, Fn.Refund, r);
        _expectRevert(HeldArbiter.NotOriginator.selector, caller, Fn.Dispute, r);
        assertEq(GUARD.balanceOf(r), 10e6);
    }

    /// Whatever sequence of actions happens, held money only ever lands with the merchant or the original payer.
    function testFuzz_FundsOnlyReachMerchantOrPayer(uint8[6] calldata actions, uint32[6] calldata waits) public {
        bytes memory r = _payOrder(50e6);
        address[4] memory callers = [buyer, MERCHANT, resolver, stranger];
        uint256 m0 = usd.balanceOf(MERCHANT);
        uint256 b0 = usd.balanceOf(buyer);
        uint256 s0 = usd.balanceOf(stranger);
        uint256 r0 = usd.balanceOf(resolver);
        for (uint256 i; i < actions.length; i++) {
            vm.warp(block.timestamp + (waits[i] % (3 days)));
            address caller = callers[actions[i] % 4];
            uint8 fn = (actions[i] / 4) % 3;
            vm.prank(caller);
            if (fn == 0) try arbiter.release(r) {} catch {}
            else if (fn == 1) try arbiter.refund(r) {} catch {}
            else try arbiter.dispute(r) {} catch {}
        }
        uint256 held = GUARD.balanceOf(r);
        uint256 toMerchant = usd.balanceOf(MERCHANT) - m0;
        uint256 toBuyer = usd.balanceOf(buyer) - b0;
        assertEq(usd.balanceOf(stranger), s0, "stranger never gains");
        assertEq(usd.balanceOf(resolver), r0, "resolver never gains");
        assertEq(held + toMerchant + toBuyer, 50e6, "no value leaks");
        assertTrue(held == 50e6 || toMerchant == 50e6 || toBuyer == 50e6, "all-or-nothing, one destination");
    }
}
