// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Tempo ReceivePolicyGuard precompile (TIP-1028). Holds transfers blocked by a receive policy.
interface IReceivePolicyGuard {
    function claim(address to, bytes calldata receipt) external;
    function balanceOf(bytes calldata receipt) external view returns (uint256);
}

/// Tempo address registry precompile (TIP-1022). Resolves virtual addresses to their master.
interface IAddressRegistry {
    function resolveRecipient(address to) external view returns (address effectiveRecipient);
}

/// Tempo TIP-403 policy registry precompile. Used once, in the constructor, to create the payout whitelist.
interface ITIP403Registry {
    function createPolicyWithAccounts(address admin, uint8 policyType, address[] calldata accounts) external returns (uint64);
}

/// The TIP-20 transfer used to split a released payment between the merchant and the fee wallet.
interface ITIP20Transfer {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title HeldArbiter
/// @notice The recovery authority for a merchant's checkout address. Every incoming transfer to that
///         address is held by the protocol's ReceivePolicyGuard. This contract is the only party that can
///         claim held funds, and it can send them to exactly two places:
///           - the merchant (release, via a "resume" claim), or
///           - the original payer (refund, via a "reroute" claim).
///         Nobody, including the merchant, the resolver or Held, can send held funds anywhere else (v3: except
///         the shop's fixed fee, taken from a release, never from a refund).
///
/// Rules:
///   - release: the buyer can confirm delivery at any time; after the protection window anyone can release.
///   - dispute: only the original payer, only inside the window, only once.
///   - a disputed payment is decided once by the resolver: release to the merchant or refund the payer.
///   - the merchant can refund voluntarily while the payment is not settled.
///   - a payment in a token the merchant doesn't accept is never released to the merchant: it can only be refunded,
///     by the payer at any time or by the merchant.
///
/// v2: a shop accepts up to three stablecoins (immutables, so Held's byte-for-byte check of the deployed code covers
/// them), and payments in other tokens can no longer reach the merchant.
///
/// v3: Held's fee, fixed per shop at deploy and never changeable: `feeBps` of a released payment (optionally capped
/// at `feeCap` per payment) goes to `feeRecipient`, but only from `feeStart` on (the free period ends then).
/// Refunds never pay a fee: the payer always gets 100% back. A release with a fee claims the payment to this
/// contract and splits it in the same transaction, so this contract never keeps a balance. For that payout to reach
/// the merchant, the constructor creates a TIP-403 whitelist holding only this contract (admin: this contract, which
/// has no code to change it), and the merchant's receive policy uses it as its sender policy: every other sender's
/// payment is still held.
contract HeldArbiter {
    uint256 public constant VERSION = 3;
    uint256 public constant MAX_FEE_BPS = 1000; // 10%: a hard ceiling on what any shop's fee can be set to
    IReceivePolicyGuard public constant GUARD = IReceivePolicyGuard(0xB10C000000000000000000000000000000000000);
    IAddressRegistry public constant REGISTRY = IAddressRegistry(0xfDC0000000000000000000000000000000000000);
    ITIP403Registry public constant POLICIES = ITIP403Registry(0x403c000000000000000000000000000000000000);
    uint8 internal constant WHITELIST = 0;

    /// ClaimReceiptV1 witness (ABI layout from TIP-1028 / ox ReceivePolicyReceipt).
    struct Receipt {
        uint8 version;
        address token;
        address recoveryAuthority;
        address originator;
        address recipient;
        uint64 blockedAt;
        uint64 blockedNonce;
        uint8 blockedReason;
        uint8 kind;
        bytes32 memo;
    }

    enum Status { None, Disputed, Released, Refunded }

    address public immutable merchant;
    address public immutable resolver;
    uint64 public immutable protectionWindow;
    // Accepted stablecoins: token0 is always set; token1 / token2 are address(0) when unused.
    address public immutable token0;
    address public immutable token1;
    address public immutable token2;
    // Fee (v3). feeBps == 0 means no fee ever; then feeRecipient may be address(0).
    address public immutable feeRecipient;
    uint16 public immutable feeBps;
    uint64 public immutable feeStart; // unix time: releases before this pay no fee
    uint256 public immutable feeCap;  // max fee per payment in token units; 0 = no cap
    // TIP-403 whitelist containing only this contract: the merchant's receive policy uses it as sender policy.
    // Storage, not immutable: its value comes from the registry at deploy time, so baking it into the code would make
    // every deployment's code different and break Held's byte-for-byte check. Set once here; no code can change it.
    uint64 public payoutPolicyId;

    mapping(bytes32 => Status) public statusOf;

    event Disputed(bytes32 indexed id, address indexed originator);
    event Released(bytes32 indexed id, address indexed caller, uint256 amount);
    event Refunded(bytes32 indexed id, address indexed caller, address indexed originator, uint256 amount);
    event FeeCharged(bytes32 indexed id, address indexed token, address indexed recipient, uint256 fee);

    error NotOurReceipt();
    error NotForMerchant();
    error AlreadySettled();
    error AlreadyDisputed();
    error NotOriginator();
    error WindowClosed();
    error NotAllowed();
    error BadConfig();

    constructor(
        address merchant_, address resolver_, address[] memory tokens_, uint64 protectionWindow_,
        address feeRecipient_, uint16 feeBps_, uint64 feeStart_, uint256 feeCap_
    ) {
        if (merchant_ == address(0) || resolver_ == address(0) || tokens_.length == 0 || tokens_.length > 3) revert BadConfig();
        if (feeBps_ > MAX_FEE_BPS || (feeBps_ > 0 && feeRecipient_ == address(0))) revert BadConfig();
        if (feeRecipient_ == merchant_ || feeRecipient_ == address(this)) revert BadConfig();
        for (uint256 i; i < tokens_.length; i++) {
            if (tokens_[i] == address(0)) revert BadConfig();
            for (uint256 j; j < i; j++) if (tokens_[i] == tokens_[j]) revert BadConfig();
        }
        merchant = merchant_;
        resolver = resolver_;
        protectionWindow = protectionWindow_;
        token0 = tokens_[0];
        token1 = tokens_.length > 1 ? tokens_[1] : address(0);
        token2 = tokens_.length > 2 ? tokens_[2] : address(0);
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        feeStart = feeStart_;
        feeCap = feeCap_;
        address[] memory self = new address[](1);
        self[0] = address(this);
        payoutPolicyId = POLICIES.createPolicyWithAccounts(address(this), WHITELIST, self);
    }

    // ------------------------------------------------------------------ views

    function acceptedTokens() external view returns (address[] memory t) {
        uint256 n = token2 != address(0) ? 3 : token1 != address(0) ? 2 : 1;
        t = new address[](n);
        t[0] = token0;
        if (n > 1) t[1] = token1;
        if (n > 2) t[2] = token2;
    }

    function accepts(address token) public view returns (bool) {
        return token != address(0) && (token == token0 || token == token1 || token == token2);
    }

    function decode(bytes calldata receipt) public pure returns (Receipt memory r) {
        r = abi.decode(receipt, (Receipt));
    }

    function idOf(bytes calldata receipt) public pure returns (bytes32) {
        return keccak256(receipt);
    }

    function windowEndsAt(bytes calldata receipt) external view returns (uint64) {
        return decode(receipt).blockedAt + protectionWindow;
    }

    /// The fee a release of `amount` would pay right now (0 before feeStart or when the shop has no fee).
    function feeFor(uint256 amount) public view returns (uint256 fee) {
        if (feeBps == 0 || block.timestamp < feeStart) return 0;
        fee = amount * feeBps / 10_000;
        if (feeCap != 0 && fee > feeCap) fee = feeCap;
    }

    // ------------------------------------------------------------ actions

    /// Buyer opens a dispute. Only the original payer, only inside the window, only once.
    function dispute(bytes calldata receipt) external {
        (bytes32 id, Receipt memory r) = _load(receipt);
        if (msg.sender != r.originator) revert NotOriginator();
        if (block.timestamp >= uint256(r.blockedAt) + protectionWindow) revert WindowClosed();
        Status s = statusOf[id];
        if (s == Status.Disputed) revert AlreadyDisputed();
        if (s != Status.None) revert AlreadySettled();
        statusOf[id] = Status.Disputed;
        emit Disputed(id, r.originator);
    }

    /// Pay the merchant. Buyer confirmation any time; permissionless after the window;
    /// resolver only if disputed. Never for a token the shop doesn't accept (those can only be refunded).
    function release(bytes calldata receipt) external {
        (bytes32 id, Receipt memory r) = _load(receipt);
        if (!accepts(r.token)) revert NotAllowed();
        Status s = statusOf[id];
        if (s == Status.Disputed) {
            if (msg.sender != resolver) revert NotAllowed();
        } else if (s == Status.None) {
            bool windowOver = block.timestamp >= uint256(r.blockedAt) + protectionWindow;
            if (msg.sender != r.originator && !windowOver) revert NotAllowed();
        } else {
            revert AlreadySettled();
        }
        statusOf[id] = Status.Released;
        uint256 amount = GUARD.balanceOf(receipt);
        uint256 fee = feeFor(amount);
        if (fee == 0) {
            GUARD.claim(merchant, receipt); // resume claim: funds go to the merchant (the policy owner)
        } else {
            // Reroute the whole payment here (partial claims don't exist), then split it in this same transaction.
            GUARD.claim(address(this), receipt);
            if (!ITIP20Transfer(r.token).transfer(merchant, amount - fee)) revert NotAllowed();
            if (!ITIP20Transfer(r.token).transfer(feeRecipient, fee)) revert NotAllowed();
            emit FeeCharged(id, r.token, feeRecipient, fee);
        }
        emit Released(id, msg.sender, amount);
    }

    /// Refund the original payer. Merchant voluntarily, resolver if disputed,
    /// or the payer themselves if they sent a token the merchant doesn't accept.
    function refund(bytes calldata receipt) external {
        (bytes32 id, Receipt memory r) = _load(receipt);
        Status s = statusOf[id];
        if (s == Status.Released || s == Status.Refunded) revert AlreadySettled();
        bool ok = msg.sender == merchant
            || (s == Status.Disputed && msg.sender == resolver)
            || (msg.sender == r.originator && !accepts(r.token));
        if (!ok) revert NotAllowed();
        statusOf[id] = Status.Refunded;
        uint256 amount = GUARD.balanceOf(receipt);
        GUARD.claim(r.originator, receipt); // reroute claim: funds go back to the payer
        emit Refunded(id, msg.sender, r.originator, amount);
    }

    // ----------------------------------------------------------- internal

    function _load(bytes calldata receipt) internal view returns (bytes32 id, Receipt memory r) {
        r = decode(receipt);
        if (r.recoveryAuthority != address(this)) revert NotOurReceipt();
        if (r.recipient != merchant && REGISTRY.resolveRecipient(r.recipient) != merchant) revert NotForMerchant();
        id = keccak256(receipt);
    }
}
