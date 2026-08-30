// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

/**
 * @title IEntryPointV08 (minimal)
 * @notice REFERENCE INTERFACE — not deployed by StealthTag.
 *
 * Canonical deployment (Sepolia):
 *   0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108
 *
 * Spec:   https://eips.ethereum.org/EIPS/eip-4337
 * Source: https://github.com/eth-infinitism/account-abstraction (v0.8)
 *
 * v0.8 specifically, because EIP-7702 UserOperations require it. Only the
 * members StealthTag uses are reproduced. Calls: `stealthtag/lib/smartAccount.ts`
 * and `stealthtag/scripts/test-sweep-local.ts`, which calls `handleOps` directly
 * while playing the bundler role against a forked chain.
 */
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

interface IEntryPointV08 {
    /**
     * @notice Emitted once per executed UserOperation.
     * @dev StealthTag reads `paymaster` from this event as PROOF of sponsorship
     *      rather than assuming it — see scripts/verify-live-sponsored.ts.
     *      A non-zero paymaster plus a full-balance sweep is only possible if
     *      the payment did not pay its own gas.
     */
    event UserOperationEvent(
        bytes32 indexed userOpHash,
        address indexed sender,
        address indexed paymaster,
        uint256 nonce,
        bool success,
        uint256 actualGasCost,
        uint256 actualGasUsed
    );

    /// @notice Execute a batch of UserOperations. Called by the bundler.
    function handleOps(PackedUserOperation[] calldata ops, address payable beneficiary) external;

    /// @notice Next valid nonce for `sender` in the given 192-bit key space.
    function getNonce(address sender, uint192 key) external view returns (uint256 nonce);

    /// @notice Gas prepaid to the EntryPoint on an account's behalf.
    function balanceOf(address account) external view returns (uint256);

    /// @notice Withdraw an account's remaining deposit.
    /// @dev Relevant to self-funded mode: unused prefund is refunded to the
    ///      DEPOSIT, not the balance, leaving a small residue at the stealth address.
    function withdrawTo(address payable withdrawAddress, uint256 amount) external;
}
