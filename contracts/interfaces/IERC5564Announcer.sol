// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IERC5564Announcer
 * @notice REFERENCE INTERFACE — not deployed by StealthTag.
 *
 * Canonical deployment (Sepolia, and identical across chains):
 *   0x55649E01B5Df198D18D95b5cc5051630cfD45564
 *
 * Spec:   https://eips.ethereum.org/EIPS/eip-5564
 * Source: https://github.com/ScopeLift/stealth-address-erc-contracts
 *
 * This file mirrors, exactly, the surface StealthTag calls. It exists so a
 * reviewer can read the on-chain interface without leaving the repo. The
 * matching ABI lives in `stealthtag/lib/chain.ts` (ANNOUNCER_ABI) and the
 * calls are in `stealthtag/lib/announcer.ts`.
 */
interface IERC5564Announcer {
    /**
     * @notice Emitted for every stealth payment so recipients can scan.
     * @dev `metadata` byte 0 is the view tag — the 1-byte prefilter that lets a
     *      recipient discard ~255 of every 256 announcements before doing any
     *      elliptic-curve work. Bytes after it describe the transfer.
     *      StealthTag publishes the minimal 1-byte form: putting the amount in
     *      metadata would hand scanners a correlation handle for free.
     * @param schemeId        1 = secp256k1 with view tags.
     * @param stealthAddress  The one-time address that received the payment.
     * @param caller          Whoever called `announce` — publicly visible.
     * @param ephemeralPubKey Sender's ephemeral public key (compressed, 33 bytes).
     * @param metadata        View tag in byte 0, optional transfer data after.
     */
    event Announcement(
        uint256 indexed schemeId,
        address indexed stealthAddress,
        address indexed caller,
        bytes ephemeralPubKey,
        bytes metadata
    );

    /// @notice Publish an announcement. Called by the SENDER, after transferring funds.
    function announce(
        uint256 schemeId,
        address stealthAddress,
        bytes memory ephemeralPubKey,
        bytes memory metadata
    ) external;
}
