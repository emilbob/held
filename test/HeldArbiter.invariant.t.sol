// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {StdPrecompiles} from "tempo-std/StdPrecompiles.sol";
import {StdTokens} from "tempo-std/StdTokens.sol";
import {ITIP20} from "tempo-std/interfaces/ITIP20.sol";
import {ITIP20RolesAuth} from "tempo-std/interfaces/ITIP20RolesAuth.sol";
import {HeldArbiter} from "../contracts/HeldArbiter.sol";

interface ITIP403ReceivePolicyI {
    function setReceivePolicy(uint64 senderPolicyId, uint64 tokenFilterId, address recoveryAuthority) external;
}

interface IGuardI {
    function balanceOf(bytes calldata receipt) external view returns (uint256);
}

/// Drives a shop through random sequences: many payments in flight (several payers, three accepted tokens and one
/// the shop doesn't accept), with random releases, refunds, disputes and time jumps from every party.
contract Handler is Test {
    event TransferBlocked(address indexed token, address indexed receiver, uint64 indexed blockedNonce, uint256 amount, uint8 receiptVersion, bytes receipt);
    IGuardI constant GUARD = IGuardI(0xB10C000000000000000000000000000000000000);
    bytes4 constant MASTER_ID = 0x82bfcada;

    HeldArbiter public arbiter;
    address public merchant;
    address public resolver;
    address[] public payers;
    address public stranger;
    ITIP20[4] public tokens; // [0..2] accepted, [3] not accepted

    struct P { bytes receipt; address payer; uint8 token; uint256 amount; }
    P[] public payments;
    // Set if a dispute past its resolve deadline ever ended with the merchant by anyone but its payer.
    bool public lateReleaseByOther;
    uint48 nextOrder = 5000;

    constructor(HeldArbiter a, address m, address r, address[] memory ps, address s, ITIP20[4] memory ts) {
        arbiter = a; merchant = m; resolver = r; payers = ps; stranger = s; tokens = ts;
    }

    function count() external view returns (uint256) { return payments.length; }
    function payment(uint256 i) external view returns (bytes memory receipt, address payer, uint8 token, uint256 amount) {
        P storage p = payments[i];
        return (p.receipt, p.payer, p.token, p.amount);
    }

    function pay(uint256 payerSeed, uint256 tokenSeed, uint256 amount, bool toMaster) external {
        if (payments.length >= 12) return;
        address payer = payers[payerSeed % payers.length];
        uint8 t = uint8(tokenSeed % 4);
        amount = bound(amount, 1, 100_000e6);
        address to = toMaster ? merchant : address(bytes20(abi.encodePacked(MASTER_ID, bytes10(0xfdfdfdfdfdfdfdfdfdfd), bytes6(nextOrder++))));
        vm.recordLogs();
        vm.prank(payer);
        tokens[t].transfer(to, amount);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(GUARD) && logs[i].topics[0] == TransferBlocked.selector) {
                (, , bytes memory receipt) = abi.decode(logs[i].data, (uint256, uint8, bytes));
                payments.push(P(receipt, payer, t, amount));
                return;
            }
        }
        revert("payment was not held");
    }

    function _who(uint256 seed, uint256 i) internal view returns (address) {
        uint256 k = seed % 4;
        return k == 0 ? payments[i].payer : k == 1 ? merchant : k == 2 ? resolver : (seed % 8 == 3 ? stranger : payers[seed % payers.length]);
    }

    function act(uint256 idx, uint256 callerSeed, uint8 fn) external {
        if (payments.length == 0) return;
        uint256 i = idx % payments.length;
        bytes memory r = payments[i].receipt;
        address caller = _who(callerSeed, i);
        bytes32 id = keccak256(r);
        bool lateDispute = arbiter.statusOf(id) == HeldArbiter.Status.Disputed && block.timestamp >= arbiter.resolveDeadline(r);
        vm.prank(caller);
        fn = fn % 3;
        if (fn == 0) {
            try arbiter.release(r) {} catch {}
            if (lateDispute && caller != payments[i].payer && arbiter.statusOf(id) == HeldArbiter.Status.Released) lateReleaseByOther = true;
        }
        else if (fn == 1) try arbiter.refund(r) {} catch {}
        else try arbiter.dispute(r) {} catch {}
    }

    function wait(uint32 secs) external {
        vm.warp(block.timestamp + (secs % (4 days)));
    }
}

contract HeldArbiterInvariantTest is Test {
    ITIP403ReceivePolicyI constant REG403 = ITIP403ReceivePolicyI(0x403c000000000000000000000000000000000000);
    IGuardI constant GUARD = IGuardI(0xB10C000000000000000000000000000000000000);
    address constant MERCHANT = 0xeDaCEd839530f85591cC7b5db6C1d79a7e6563ed;
    bytes32 constant SALT = 0x000000000000000000000000000000000000000000000000000000013b771de3;
    uint64 constant WINDOW = 7 days;
    uint64 constant RESOLVE = 3 days; // shorter than the handler's longest wait, so random runs cross deadlines

    Handler h;
    HeldArbiter arbiter;
    ITIP20[4] tokens;
    address resolver = makeAddr("resolver");
    address stranger = makeAddr("stranger");
    address feeWallet = makeAddr("feeWallet");
    uint16 constant FEE_BPS = 100;
    address[] payers;
    uint256 constant START = 1_000_000_000e6;
    mapping(address => mapping(uint256 => uint256)) start;

    function setUp() public {
        vm.warp(1_790_000_000);
        for (uint256 i; i < 4; i++) {
            tokens[i] = ITIP20(StdPrecompiles.TIP20_FACTORY.createToken("USD", "USD", "USD", StdTokens.PATH_USD, address(this), bytes32(i + 10)));
            ITIP20RolesAuth(address(tokens[i])).grantRole(tokens[i].ISSUER_ROLE(), address(this));
        }
        address[] memory accepted = new address[](3);
        for (uint256 i; i < 3; i++) accepted[i] = address(tokens[i]);
        // Fee on from the start (v3), so every random release exercises the split.
        arbiter = new HeldArbiter(MERCHANT, resolver, accepted, WINDOW, RESOLVE, feeWallet, FEE_BPS, uint64(block.timestamp), 0);
        vm.startPrank(MERCHANT);
        StdPrecompiles.ADDRESS_REGISTRY.registerVirtualMaster(SALT);
        REG403.setReceivePolicy(arbiter.payoutPolicyId(), 1, address(arbiter));
        vm.stopPrank();

        payers.push(makeAddr("payer1")); payers.push(makeAddr("payer2")); payers.push(makeAddr("payer3"));
        address[7] memory everyone = [payers[0], payers[1], payers[2], stranger, resolver, MERCHANT, feeWallet];
        for (uint256 a; a < everyone.length; a++)
            for (uint256 t; t < 4; t++) {
                if (everyone[a] != MERCHANT && everyone[a] != feeWallet) tokens[t].mint(everyone[a], START);
                start[everyone[a]][t] = tokens[t].balanceOf(everyone[a]);
            }

        h = new Handler(arbiter, MERCHANT, resolver, payers, stranger, tokens);
        targetContract(address(h));
    }

    /// Per token: every unit paid is either still held, with the merchant, with the fee wallet (at most the fee),
    /// or back with its payer. Nothing else.
    function invariant_NoValueLeaks() public view {
        for (uint256 t; t < 4; t++) {
            uint256 paid; uint256 held;
            for (uint256 i; i < h.count(); i++) {
                (bytes memory r, , uint8 tok, uint256 amount) = h.payment(i);
                if (tok != t) continue;
                paid += amount;
                held += GUARD.balanceOf(r);
            }
            uint256 merchantGain = tokens[t].balanceOf(MERCHANT) - start[MERCHANT][t];
            uint256 feeGain = tokens[t].balanceOf(feeWallet) - start[feeWallet][t];
            uint256 payersNow; uint256 payersStart;
            for (uint256 p; p < payers.length; p++) { payersNow += tokens[t].balanceOf(payers[p]); payersStart += start[payers[p]][t]; }
            uint256 payersLost = payersStart - payersNow;
            assertEq(held + merchantGain + feeGain, payersLost, "every unit is held, with the merchant or the fee; refunds net out");
            assertLe(feeGain * 10_000, (merchantGain + feeGain) * FEE_BPS, "fee is at most 1% of what was released");
            assertLe(payersLost, paid, "payers never lose more than they paid");
        }
    }

    /// Strangers and the resolver never gain anything; the merchant never gains a token it doesn't accept.
    function invariant_OnlyMerchantOrPayerGain() public view {
        for (uint256 t; t < 4; t++) {
            assertEq(tokens[t].balanceOf(stranger), start[stranger][t], "stranger never gains or loses");
            assertEq(tokens[t].balanceOf(resolver), start[resolver][t], "resolver never gains or loses");
        }
        assertEq(tokens[3].balanceOf(MERCHANT), start[MERCHANT][3], "merchant never receives an unaccepted token");
        assertEq(tokens[3].balanceOf(feeWallet), 0, "no fee is ever taken from an unaccepted token");
    }

    /// Past a dispute's resolve deadline only the buyer can still send the money to the merchant (withdrawing their
    /// dispute); everyone else, the resolver included, can only refund.
    function invariant_LateDisputeOnlyRefundsUnlessBuyerWithdraws() public view {
        assertFalse(h.lateReleaseByOther(), "an expired dispute reached the merchant without the buyer");
    }

    /// The arbiter splits a release inside one transaction: it never ends a call holding any token.
    function invariant_ArbiterNeverKeepsFunds() public view {
        for (uint256 t; t < 4; t++) assertEq(tokens[t].balanceOf(address(arbiter)), 0, "arbiter balance is always 0");
    }

    /// Each payment is all-or-nothing: fully held, or fully settled to one place, matching its recorded status.
    function invariant_EachPaymentSettlesOnce() public view {
        for (uint256 i; i < h.count(); i++) {
            (bytes memory r, , , uint256 amount) = h.payment(i);
            uint256 held = GUARD.balanceOf(r);
            HeldArbiter.Status s = arbiter.statusOf(keccak256(r));
            if (s == HeldArbiter.Status.Released || s == HeldArbiter.Status.Refunded) assertEq(held, 0, "settled means empty");
            else assertEq(held, amount, "unsettled means fully held");
        }
    }
}
