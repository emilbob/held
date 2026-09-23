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

/// @title HeldArbiter
/// @notice The recovery authority for a merchant's checkout address. Every incoming transfer to that
///         address is held by the protocol's ReceivePolicyGuard. This contract is the only party that can
///         claim held funds, and it can send them to exactly two places:
///           - the merchant (release, via a "resume" claim), or
///           - the original payer (refund, via a "reroute" claim).
///         Nobody, including the merchant, the resolver or Held, can send held funds anywhere else.
///
/// Rules:
///   - release: the buyer can confirm delivery at any time; after the protection window anyone can release.
///   - dispute: only the original payer, only inside the window, only once.
///   - a disputed payment is decided once by the resolver: release to the merchant or refund the payer.
///   - the merchant can refund voluntarily while the payment is not settled.
///   - a payment in a token the merchant doesn't accept can be refunded by the payer at any time.
contract HeldArbiter {
    IReceivePolicyGuard public constant GUARD = IReceivePolicyGuard(0xB10C000000000000000000000000000000000000);
    IAddressRegistry public constant REGISTRY = IAddressRegistry(0xfDC0000000000000000000000000000000000000);

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
    address public immutable acceptedToken;
    uint64 public immutable protectionWindow;

    mapping(bytes32 => Status) public statusOf;

    event Disputed(bytes32 indexed id, address indexed originator);
    event Released(bytes32 indexed id, address indexed caller, uint256 amount);
    event Refunded(bytes32 indexed id, address indexed caller, address indexed originator, uint256 amount);

    error NotOurReceipt();
    error NotForMerchant();
    error AlreadySettled();
    error AlreadyDisputed();
    error NotOriginator();
    error WindowClosed();
    error NotAllowed();

    constructor(address merchant_, address resolver_, address acceptedToken_, uint64 protectionWindow_) {
        merchant = merchant_;
        resolver = resolver_;
        acceptedToken = acceptedToken_;
        protectionWindow = protectionWindow_;
    }

    // ------------------------------------------------------------------ views

    function decode(bytes calldata receipt) public pure returns (Receipt memory r) {
        r = abi.decode(receipt, (Receipt));
    }

    function idOf(bytes calldata receipt) public pure returns (bytes32) {
        return keccak256(receipt);
    }

    function windowEndsAt(bytes calldata receipt) external view returns (uint64) {
        return decode(receipt).blockedAt + protectionWindow;
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
    /// resolver only if disputed.
    function release(bytes calldata receipt) external {
        (bytes32 id, Receipt memory r) = _load(receipt);
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
        GUARD.claim(merchant, receipt); // resume claim: funds go to the merchant (the policy owner)
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
            || (msg.sender == r.originator && r.token != acceptedToken);
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
