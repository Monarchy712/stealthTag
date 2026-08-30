// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

/**
 * @title ISimple7702Account
 * @notice REFERENCE INTERFACE — not deployed by StealthTag.
 *
 * Canonical deployment (Sepolia):
 *   0xe6Cae83BdE06E4c305530e199D7217f42808555B
 *
 * Source: https://github.com/eth-infinitism/account-abstraction
 *         (contracts/accounts/Simple7702Account.sol)
 *
 * THIS IS THE KEY PIECE OF THE ARCHITECTURE.
 *
 * An ERC-5564 stealth address is a plain EOA holding ETH but with no way to
 * pay for its own first transaction. Building a smart account *owned by* the
 * stealth key does not help: that account lives at a DIFFERENT address than
 * the one holding the funds.
 *
 * Under EIP-7702 the stealth EOA signs an authorization delegating its code to
 * this stateless implementation. Its account code becomes
 * `0xef0100 || <this address>`, and the account address IS the EOA address. So
 * the address that received the ERC-5564 payment and the `sender` of the
 * ERC-4337 UserOperation are the same address — no migration hop, nothing
 * extra to correlate.
 *
 * Verified end to end: `stealthtag/scripts/test-sweep-local.ts` (forked chain)
 * and live on Sepolia in tx 0x49005793174c338d139893f0d02169fa25edd19e695f82b963bf19d4fe8ae131.
 */
struct Call {
    address target;
    uint256 value;
    bytes data;
}

interface ISimple7702Account {
    /// @notice Execute a single call. Callable by the EntryPoint or by the account itself.
    function execute(address target, uint256 value, bytes calldata data) external payable;

    /// @notice Execute a batch of calls.
    function executeBatch(Call[] calldata calls) external payable;

    /**
     * @notice ERC-4337 validation hook.
     * @dev Validates an ECDSA signature over `userOpHash` and requires the
     *      recovered signer to be `address(this)` — i.e. the stealth key itself.
     *      This is what makes a UserOperation signed by any other key fail;
     *      asserted by the negative case in test-sweep-local.ts.
     */
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData);
}

// Re-declared so this file reads standalone; identical to IEntryPointV08.sol.
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
