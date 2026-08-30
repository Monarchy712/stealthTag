// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IERC6538Registry
 * @notice REFERENCE INTERFACE — not deployed by StealthTag.
 *
 * Canonical deployment (Sepolia):
 *   0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538
 *
 * Spec:   https://eips.ethereum.org/EIPS/eip-6538
 * Source: https://github.com/ScopeLift/stealth-address-erc-contracts
 *
 * Mirrors the surface StealthTag calls. ABI: `stealthtag/lib/chain.ts`
 * (REGISTRY_ABI); calls: `stealthtag/lib/registry.ts`.
 *
 * PRIVACY NOTE: registration is a PUBLIC, PERMANENT link between a real address
 * and a stealth meta-address. It is how senders discover you, and it is one of
 * the correlations StealthTag documents rather than hides. Registering is
 * optional — a meta-address can be shared out of band instead.
 */
interface IERC6538Registry {
    /// @notice Emitted when a registrant publishes a stealth meta-address.
    event StealthMetaAddressSet(
        address indexed registrant,
        uint256 indexed schemeId,
        bytes stealthMetaAddress
    );

    /**
     * @notice Publish your stealth meta-address for a scheme.
     * @param stealthMetaAddress For scheme 1: two COMPRESSED secp256k1 public
     *        keys concatenated — spending key then viewing key, 66 bytes total.
     */
    function registerKeys(uint256 schemeId, bytes calldata stealthMetaAddress) external;

    /// @notice Resolve a registrant to their published meta-address. Empty if unregistered.
    function stealthMetaAddressOf(address registrant, uint256 schemeId)
        external
        view
        returns (bytes memory);
}
