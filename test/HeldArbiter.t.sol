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
    event FeeCharged(bytes32 indexed id, address indexed token, address indexed recipient, uint256 fee);

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
    address feeWallet = makeAddr("feeWallet");
    uint16 constant FEE_BPS = 100; // 1%
    // The default arbiter's free period lasts a year past setUp's clock, so the v2 behaviour tests pay no fee.
    uint64 constant FEE_START = 1_790_000_000 + 365 days;

    ITIP20 usd;   // accepted token (token0)
    ITIP20 usd2;  // also accepted (token1)
    ITIP20 usd3;  // also accepted (token2)
    ITIP20 other; // a token the merchant doesn't accept
    HeldArbiter arbiter;

    function setUp() public {
        vm.warp(1_790_000_000);
        usd = _newToken("Test USD", "TUSD", 1);
        other = _newToken("Other USD", "OUSD", 2);
        usd2 = _newToken("Second USD", "SUSD", 3);
        usd3 = _newToken("Third USD", "XUSD", 4);
        arbiter = _deploy(FEE_BPS, FEE_START, 0);

        vm.startPrank(MERCHANT);
        StdPrecompiles.ADDRESS_REGISTRY.registerVirtualMaster(SALT);
        REG403.setReceivePolicy(arbiter.payoutPolicyId(), ALLOW_ALL, address(arbiter));
        vm.stopPrank();

        for (uint256 i; i < 3; i++) {
            address a = [buyer, stranger, resolver][i];
            usd.mint(a, 1_000_000e6);
            usd2.mint(a, 1_000_000e6);
            usd3.mint(a, 1_000_000e6);
            other.mint(a, 1_000_000e6);
        }
    }

    // ------------------------------------------------------------------ helpers

    function _deploy(uint16 bps, uint64 feeStart, uint256 cap) internal returns (HeldArbiter) {
        return new HeldArbiter(MERCHANT, resolver, _list(address(usd), address(usd2), address(usd3)), WINDOW, feeWallet, bps, feeStart, cap);
    }

    /// Point the merchant's receive policy at a fresh arbiter (as a merchant re-running setup would).
    function _useArbiter(HeldArbiter a) internal {
        arbiter = a;
        uint64 policy = a.payoutPolicyId(); // read first: an external call in the arguments would use up the prank
        vm.prank(MERCHANT);
        REG403.setReceivePolicy(policy, ALLOW_ALL, address(a));
    }

    function _list(address a, address b, address c) internal pure returns (address[] memory t) {
        uint256 n = c != address(0) ? 3 : b != address(0) ? 2 : 1;
        t = new address[](n);
        t[0] = a;
        if (n > 1) t[1] = b;
        if (n > 2) t[2] = c;
    }

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
        uint64 policy = arbiter.payoutPolicyId();
        vm.prank(otherMerchant);
        REG403.setReceivePolicy(policy, ALLOW_ALL, address(arbiter));
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

    // ------------------------------------------------------------------ v2: several stablecoins, wrong tokens never reach the merchant

    function test_AcceptedTokensView() public view {
        address[] memory t = arbiter.acceptedTokens();
        assertEq(t.length, 3);
        assertEq(t[0], address(usd));
        assertEq(t[1], address(usd2));
        assertEq(t[2], address(usd3));
        assertTrue(arbiter.accepts(address(usd2)));
        assertFalse(arbiter.accepts(address(other)));
        assertFalse(arbiter.accepts(address(0)));
        assertEq(arbiter.VERSION(), 3);
    }

    function test_EveryAcceptedTokenReleasesToMerchant() public {
        ITIP20[3] memory ts = [usd, usd2, usd3];
        for (uint256 i; i < 3; i++) {
            bytes memory r = _pay(buyer, _orderAddress(uint48(2000 + i)), ts[i], 9e6);
            uint256 before = ts[i].balanceOf(MERCHANT);
            vm.prank(buyer);
            arbiter.release(r);
            assertEq(ts[i].balanceOf(MERCHANT) - before, 9e6);
        }
    }

    function test_SecondTokenFollowsTheSameRules() public {
        bytes memory r = _pay(buyer, _orderAddress(2010), usd2, 4e6);
        _expectRevert(HeldArbiter.NotAllowed.selector, MERCHANT, Fn.Release, r);
        _expectRevert(HeldArbiter.NotAllowed.selector, buyer, Fn.Refund, r);
        vm.prank(buyer);
        arbiter.dispute(r);
        uint256 before = usd2.balanceOf(buyer);
        vm.prank(resolver);
        arbiter.refund(r);
        assertEq(usd2.balanceOf(buyer) - before, 4e6);
    }

    function test_WrongToken_BuyerCannotReleaseToMerchant() public {
        bytes memory r = _pay(buyer, _orderAddress(1044), other, 7e6);
        _expectRevert(HeldArbiter.NotAllowed.selector, buyer, Fn.Release, r);
    }

    function test_WrongToken_NotReleasableAfterWindow() public {
        bytes memory r = _pay(buyer, _orderAddress(1044), other, 7e6);
        vm.warp(block.timestamp + WINDOW + 1 days);
        _expectRevert(HeldArbiter.NotAllowed.selector, stranger, Fn.Release, r);
        _expectRevert(HeldArbiter.NotAllowed.selector, MERCHANT, Fn.Release, r);
        // …and the payer can still get it back, long after the window.
        uint256 before = other.balanceOf(buyer);
        vm.prank(buyer);
        arbiter.refund(r);
        assertEq(other.balanceOf(buyer) - before, 7e6);
    }

    function test_WrongToken_ResolverCanOnlyRefund() public {
        bytes memory r = _pay(buyer, _orderAddress(1045), other, 7e6);
        vm.prank(buyer);
        arbiter.dispute(r);
        _expectRevert(HeldArbiter.NotAllowed.selector, resolver, Fn.Release, r);
        vm.prank(resolver);
        arbiter.refund(r);
        assertEq(uint8(arbiter.statusOf(keccak256(r))), uint8(HeldArbiter.Status.Refunded));
    }

    function test_SingleTokenShop() public {
        HeldArbiter one = new HeldArbiter(MERCHANT, resolver, _list(address(usd), address(0), address(0)), WINDOW, feeWallet, FEE_BPS, FEE_START, 0);
        address[] memory t = one.acceptedTokens();
        assertEq(t.length, 1);
        assertEq(one.token1(), address(0));
        assertFalse(one.accepts(address(usd2)));
    }

    function test_ConstructorRejectsBadConfig() public {
        address[] memory none = new address[](0);
        address[] memory four = new address[](4);
        four[0] = address(usd); four[1] = address(usd2); four[2] = address(usd3); four[3] = address(other);
        address[] memory dup = _list(address(usd), address(usd), address(0));
        address[] memory zero = new address[](2);
        zero[0] = address(usd);
        address[] memory ok = _list(address(usd), address(0), address(0));
        vm.expectRevert(HeldArbiter.BadConfig.selector); new HeldArbiter(MERCHANT, resolver, none, WINDOW, feeWallet, FEE_BPS, FEE_START, 0);
        vm.expectRevert(HeldArbiter.BadConfig.selector); new HeldArbiter(MERCHANT, resolver, four, WINDOW, feeWallet, FEE_BPS, FEE_START, 0);
        vm.expectRevert(HeldArbiter.BadConfig.selector); new HeldArbiter(MERCHANT, resolver, dup, WINDOW, feeWallet, FEE_BPS, FEE_START, 0);
        vm.expectRevert(HeldArbiter.BadConfig.selector); new HeldArbiter(MERCHANT, resolver, zero, WINDOW, feeWallet, FEE_BPS, FEE_START, 0);
        vm.expectRevert(HeldArbiter.BadConfig.selector); new HeldArbiter(address(0), resolver, ok, WINDOW, feeWallet, FEE_BPS, FEE_START, 0);
        vm.expectRevert(HeldArbiter.BadConfig.selector); new HeldArbiter(MERCHANT, address(0), ok, WINDOW, feeWallet, FEE_BPS, FEE_START, 0);
        // Fee settings: above the 10% ceiling, a fee with no wallet, or the merchant as its own fee wallet.
        vm.expectRevert(HeldArbiter.BadConfig.selector); new HeldArbiter(MERCHANT, resolver, ok, WINDOW, feeWallet, 1001, FEE_START, 0);
        vm.expectRevert(HeldArbiter.BadConfig.selector); new HeldArbiter(MERCHANT, resolver, ok, WINDOW, address(0), FEE_BPS, FEE_START, 0);
        vm.expectRevert(HeldArbiter.BadConfig.selector); new HeldArbiter(MERCHANT, resolver, ok, WINDOW, MERCHANT, FEE_BPS, FEE_START, 0);
        // A shop with no fee at all needs no fee wallet.
        HeldArbiter free = new HeldArbiter(MERCHANT, resolver, ok, WINDOW, address(0), 0, 0, 0);
        assertEq(free.feeFor(1_000e6), 0);
    }

    // ------------------------------------------------------------------ fee (v3)

    function test_Fee_NoneDuringFreePeriod() public {
        bytes memory r = _payOrder(100e6);
        uint256 m0 = usd.balanceOf(MERCHANT);
        assertEq(arbiter.feeFor(100e6), 0, "free period");
        vm.prank(buyer);
        arbiter.release(r);
        assertEq(usd.balanceOf(MERCHANT) - m0, 100e6, "merchant gets everything");
        assertEq(usd.balanceOf(feeWallet), 0);
    }

    function test_Fee_SplitAfterFreePeriod() public {
        bytes memory r = _payOrder(100e6);
        vm.warp(FEE_START); // the free period ends exactly here
        uint256 m0 = usd.balanceOf(MERCHANT);
        vm.expectEmit(address(arbiter));
        emit FeeCharged(keccak256(r), address(usd), feeWallet, 1e6);
        vm.prank(buyer);
        arbiter.release(r);
        assertEq(usd.balanceOf(MERCHANT) - m0, 99e6, "merchant gets 99%");
        assertEq(usd.balanceOf(feeWallet), 1e6, "fee wallet gets 1%");
        assertEq(usd.balanceOf(address(arbiter)), 0, "arbiter keeps nothing");
        assertEq(GUARD.balanceOf(r), 0);
    }

    function test_Fee_OneSecondBeforeStartIsFree() public {
        bytes memory r = _payOrder(100e6);
        vm.warp(FEE_START - 1);
        vm.prank(buyer);
        arbiter.release(r);
        assertEq(usd.balanceOf(feeWallet), 0);
    }

    function test_Fee_ResolverReleaseOfDisputePaysFee() public {
        _useArbiter(_deploy(FEE_BPS, uint64(block.timestamp), 0));
        bytes memory r = _payOrder(50e6);
        vm.prank(buyer);
        arbiter.dispute(r);
        vm.prank(resolver);
        arbiter.release(r);
        assertEq(usd.balanceOf(feeWallet), 0.5e6);
        assertEq(usd.balanceOf(resolver), 1_000_000e6, "resolver never gains");
    }

    function test_Fee_RefundsAreAlwaysFree() public {
        _useArbiter(_deploy(FEE_BPS, uint64(block.timestamp), 0));
        bytes memory r1 = _payOrder(80e6);
        bytes memory r2 = _pay(buyer, _orderAddress(1043), usd2, 30e6);
        uint256 b1 = usd.balanceOf(buyer);
        uint256 b2 = usd2.balanceOf(buyer);
        vm.prank(MERCHANT);
        arbiter.refund(r1);
        vm.prank(buyer);
        arbiter.dispute(r2);
        vm.prank(resolver);
        arbiter.refund(r2);
        assertEq(usd.balanceOf(buyer) - b1, 80e6, "voluntary refund: 100% back");
        assertEq(usd2.balanceOf(buyer) - b2, 30e6, "dispute refund: 100% back");
        assertEq(usd.balanceOf(feeWallet) + usd2.balanceOf(feeWallet), 0, "no fee on refunds");
    }

    function test_Fee_Cap() public {
        _useArbiter(_deploy(FEE_BPS, uint64(block.timestamp), 5e6));
        bytes memory r = _payOrder(2_000e6); // 1% would be $20
        vm.prank(buyer);
        arbiter.release(r);
        assertEq(usd.balanceOf(feeWallet), 5e6, "capped at $5");
        assertEq(usd.balanceOf(MERCHANT), 1_995e6);
    }

    function test_Fee_TinyPaymentRoundsToNoFee() public {
        _useArbiter(_deploy(FEE_BPS, uint64(block.timestamp), 0));
        bytes memory r = _payOrder(99); // 0.000099: 1% rounds down to 0
        uint256 m0 = usd.balanceOf(MERCHANT);
        vm.prank(buyer);
        arbiter.release(r);
        assertEq(usd.balanceOf(MERCHANT) - m0, 99);
        assertEq(usd.balanceOf(feeWallet), 0);
    }

    function test_Fee_WrongTokenStillOnlyRefundable() public {
        _useArbiter(_deploy(FEE_BPS, uint64(block.timestamp), 0));
        bytes memory r = _pay(buyer, _orderAddress(1047), other, 10e6);
        _expectRevert(HeldArbiter.NotAllowed.selector, buyer, Fn.Release, r);
        vm.prank(buyer);
        arbiter.refund(r);
        assertEq(other.balanceOf(feeWallet), 0);
        assertEq(other.balanceOf(MERCHANT), 0);
    }

    /// The payout whitelist lets only the arbiter through: every other sender's payment, even straight to the
    /// merchant's master address, is still held.
    function test_PayoutPolicy_OnlyArbiterPassesThrough() public {
        _pay(stranger, MERCHANT, usd, 3e6);           // reverts if not held
        _pay(buyer, MERCHANT, usd2, 4e6);
        uint64 policy = arbiter.payoutPolicyId();
        vm.prank(MERCHANT);
        vm.expectRevert(); // nobody but the arbiter (the policy's admin, with no code for it) can edit the whitelist
        StdPrecompiles.TIP403_REGISTRY.modifyPolicyWhitelist(policy, buyer, true);
    }

    /// Fuzz: whatever the amount, fee and cap, the merchant's share plus the fee is exactly the payment.
    function testFuzz_FeeSplitIsExact(uint96 amount, uint16 bps, uint64 cap) public {
        amount = uint96(bound(amount, 1, 100_000e6));
        bps = uint16(bound(bps, 1, 1000));
        _useArbiter(_deploy(bps, uint64(block.timestamp), cap));
        usd.mint(buyer, amount);
        bytes memory r = _payOrder(amount);
        uint256 m0 = usd.balanceOf(MERCHANT);
        uint256 want = uint256(amount) * bps / 10_000;
        if (cap != 0 && want > cap) want = cap;
        vm.prank(buyer);
        arbiter.release(r);
        assertEq(usd.balanceOf(feeWallet), want, "fee");
        assertEq(usd.balanceOf(MERCHANT) - m0 + usd.balanceOf(feeWallet), amount, "merchant + fee == payment");
        assertEq(usd.balanceOf(address(arbiter)), 0, "arbiter keeps nothing");
    }

    /// Whatever happens to a wrong-token payment, the merchant never receives it.
    function testFuzz_WrongTokenNeverReachesMerchant(uint8[6] calldata actions, uint32[6] calldata waits) public {
        bytes memory r = _pay(buyer, _orderAddress(1046), other, 25e6);
        address[4] memory callers = [buyer, MERCHANT, resolver, stranger];
        uint256 m0 = other.balanceOf(MERCHANT);
        uint256 b0 = other.balanceOf(buyer);
        for (uint256 i; i < actions.length; i++) {
            vm.warp(block.timestamp + (waits[i] % (10 days)));
            address caller = callers[actions[i] % 4];
            uint8 fn = (actions[i] / 4) % 3;
            vm.prank(caller);
            if (fn == 0) try arbiter.release(r) {} catch {}
            else if (fn == 1) try arbiter.refund(r) {} catch {}
            else try arbiter.dispute(r) {} catch {}
        }
        assertEq(other.balanceOf(MERCHANT), m0, "merchant never receives a token it doesn't accept");
        assertTrue(GUARD.balanceOf(r) == 25e6 || other.balanceOf(buyer) - b0 == 25e6, "held, or back with the payer");
    }
}
