// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

/**
 * @title IPaymaster
 * @notice REFERENCE INTERFACE — not deployed by StealthTag.
 *
 * Live instance used (Sepolia): Pimlico verifying paymaster
 *   0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402
 *
 * Spec:   https://eips.ethereum.org/EIPS/eip-4337
 * Source: https://github.com/eth-infinitism/account-abstraction
 *
 * WHY StealthTag uses one: so a stealth address can sweep WITHOUT first
 * receiving gas from the recipient's known wallet. That transfer would publish
 * exactly the link stealth addresses exist to avoid.
 *
 * WHAT IT DOES NOT DO: it does not make anything anonymous. A paymaster SEES
 * every operation it sponsors, and its address is public on-chain in every one
 * of them — so sponsored sweeps are enumerable as a set. StealthTag therefore
 * also offers a self-funded mode (`gasMode: 'self-funded'`) where the stealth
 * address pays gas out of the ETH it already received and no paymaster is
 * involved at all, which is strictly less correlated. See PRIVACY.md §3.
 */
interface IPaymaster {
    enum PostOpMode { opSucceeded, opReverted, postOpReverted }

    /// @notice Called by the EntryPoint to decide whether to sponsor this operation.
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData);

    /// @notice Called after execution so the paymaster can settle.
    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external;
}

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
