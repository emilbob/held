// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// Tempo TIP-403 policy registry precompile: an account's receive policy.
interface ITIP403ReceivePolicyView {
    function receivePolicy(address account) external view returns (
        bool hasReceivePolicy, uint64 senderPolicyId, uint8 senderPolicyType,
        uint64 tokenFilterId, uint8 tokenFilterType, address recoveryAuthority);
}

/// Tempo address registry precompile (TIP-1022): virtual address -> master.
interface IAddressRegistryView {
    function resolveRecipient(address to) external view returns (address effectiveRecipient);
}

interface ITIP20TransferFrom {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title HeldPayCheck
/// @notice Makes "is this shop still protected?" and "pay" one atomic step, so a merchant can't switch its receive
///         policy off between the buyer's check and the payment (the window while a wallet prompt is open).
///         Stateless and ownerless: one deployment per network serves every shop.
///           - requireHeld: reverts unless `to` belongs to `merchant` and the merchant's receive policy still holds every
///             payment for `arbiter` (the same test as shared/protection.ts policyHolds). Put it first in a batched Tempo
///             transaction, before the TIP-20 transfer: if it reverts, the whole transaction reverts.
///           - payChecked: the same check plus transferFrom(buyer -> to), for wallets that can't batch calls.
contract HeldPayCheck {
    ITIP403ReceivePolicyView public constant POLICIES = ITIP403ReceivePolicyView(0x403c000000000000000000000000000000000000);
    IAddressRegistryView public constant REGISTRY = IAddressRegistryView(0xfDC0000000000000000000000000000000000000);

    error NotHeld();
    error NotMerchantAddress();
    error TransferFailed();

    function requireHeld(address to, address merchant, address arbiter, uint64 payoutPolicyId) public view {
        if (to != merchant && REGISTRY.resolveRecipient(to) != merchant) revert NotMerchantAddress();
        (bool has, uint64 senderPolicyId,,,, address recoveryAuthority) = POLICIES.receivePolicy(merchant);
        if (!has || recoveryAuthority != arbiter || senderPolicyId != payoutPolicyId) revert NotHeld();
    }

    function payChecked(address token, address to, uint256 amount, address merchant, address arbiter, uint64 payoutPolicyId) external {
        requireHeld(to, merchant, arbiter, payoutPolicyId);
        if (!ITIP20TransferFrom(token).transferFrom(msg.sender, to, amount)) revert TransferFailed();
    }
}
