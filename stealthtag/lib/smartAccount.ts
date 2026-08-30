/**
 * lib/smartAccount.ts
 * --------------------
 * Sweeping an ERC-5564 stealth address via an EIP-7702 + ERC-4337
 * UserOperation, sponsored by a Paymaster, submitted through the relay.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES
 * ---------------------------------------------------------------------------
 * An ERC-5564 Scheme 1 stealth address is `publicKeyToAddress(stealthPubKey)`:
 * a plain **EOA**, controlled by the stealth private key that `computeStealthKey`
 * reconstructs. ETH sent by the sender sits at that EOA. To move it, a
 * transaction must originate there — and a bare EOA must pay its own gas.
 *
 * Funding it from the recipient's known wallet would publish exactly the link
 * stealth addresses exist to avoid:
 *
 *     known wallet ──funds gas──▶ stealth address ──sweep──▶ destination
 *                    ^^^^^^^^^^ one hop, trivially followed
 *
 * ---------------------------------------------------------------------------
 * WHY EIP-7702 AND NOT A COUNTERFACTUAL SMART ACCOUNT
 * ---------------------------------------------------------------------------
 * The previous implementation built a Kernel v3 account *owned by* the stealth
 * key. That account lives at a DIFFERENT address from the stealth EOA:
 *
 *     stealth EOA        0x556a…0587   ← the ETH is here
 *     Kernel v3 account  0xeAF1…Fbd5   ← the UserOperation came from here (0 wei)
 *
 * so every sweep failed. Moving the funds into that account first would need a
 * transaction from the EOA — the original problem, unsolved.
 *
 * EIP-7702 removes the mismatch instead of working around it. The stealth EOA
 * signs an authorization delegating its code to a stateless smart-account
 * implementation; the account address IS the EOA address. The ERC-5564
 * receiving address and the ERC-4337 `sender` are then the same address, and
 * NO migration or forwarding transfer is required — so nothing about the
 * stealth-address unlinkability is given up to get executability.
 *
 * Signing the authorization and the UserOperation both cost the stealth
 * address nothing: the Paymaster pays, and the bundler submits.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES *NOT* GIVE YOU
 * ---------------------------------------------------------------------------
 * Gas sponsorship is not privacy. This removes the INBOUND funding link. It
 * does nothing about the OUTBOUND one: sweeping to your known wallet publishes
 * `stealthAddress → knownWallet` on-chain, and amount correlation does the
 * rest. Choosing the destination is the user's decision and the single largest
 * remaining correlation risk. See PRIVACY.md.
 */

import { createSmartAccountClient } from 'permissionless';
import { to7702SimpleSmartAccount } from 'permissionless/accounts';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { entryPoint08Address } from 'viem/account-abstraction';
import { createPublicClient, formatEther, type LocalAccount } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { relayBundlerTransport, relayRpcTransport } from './relay';
import type { DetectedPayment } from '@/types';

/**
 * The stateless EIP-7702 delegate the stealth EOA points at.
 * `Simple7702Account` from eth-infinitism, the default in permissionless.js.
 * Verified deployed on Sepolia (3639 bytes) — see scripts/test-relay.ts.
 */
export const EIP7702_IMPLEMENTATION =
  '0xe6Cae83BdE06E4c305530e199D7217f42808555B' as `0x${string}`;

/** EIP-7702 UserOperations require EntryPoint v0.8. */
export const ENTRYPOINT_ADDRESS = entryPoint08Address;

// ===========================================================
// Account construction
// ===========================================================

/**
 * Build the EIP-7702 smart account for a stealth key.
 *
 * The returned account's address is EXACTLY `signer.address` — the ERC-5564
 * stealth address. That identity is the whole point; `assertAccountIsStealthAddress`
 * enforces it rather than trusting it.
 */
export async function createStealthSmartAccount(signer: LocalAccount) {
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: relayRpcTransport(),
  });

  const account = await to7702SimpleSmartAccount({
    client: publicClient,
    owner: signer,
  });

  assertAccountIsStealthAddress(account.address, signer.address);

  return { account, publicClient };
}

/**
 * Reconciliation gate: the address executing the UserOperation must be the
 * address that received the ERC-5564 payment. If these ever diverge, the funds
 * are not reachable and the sweep must not be attempted.
 */
export function assertAccountIsStealthAddress(
  accountAddress: `0x${string}`,
  stealthAddress: `0x${string}`,
): void {
  if (accountAddress.toLowerCase() !== stealthAddress.toLowerCase()) {
    throw new Error(
      `Account/stealth address mismatch: UserOperation sender ${accountAddress} ` +
        `is not the stealth address ${stealthAddress} that holds the funds. ` +
        `Refusing to build a UserOperation that cannot move them.`,
    );
  }
}

/**
 * Counterfactual sweep address for a detected payment — always the stealth
 * address itself under EIP-7702. Exposed so the UI can show that no second
 * address is involved.
 */
export function sweepSenderAddress(payment: DetectedPayment): `0x${string}` {
  return privateKeyToAccount(payment.stealthPrivateKey).address;
}

// ===========================================================
// Sponsored sweep
// ===========================================================

/**
 * How the sweep's gas is paid.
 *
 * 'self-funded' — the stealth address prefunds the EntryPoint out of the ETH
 *   it already received. NO third party is involved in payment, so there is no
 *   Paymaster to correlate against and no sponsorship record tying this sweep
 *   to any other. Strictly the *less* correlated of the two. Costs: the
 *   payment must exceed gas, and the EntryPoint refunds unused prefund to the
 *   account's deposit rather than its balance, leaving a small residue at the
 *   stealth address.
 *
 * 'sponsored' — a Paymaster pays. Required when the stealth address holds no
 *   ETH (an ERC-20-only payment) or when the amount is too small to cover gas,
 *   and it lets the full balance be swept with nothing left behind. Cost: the
 *   Paymaster sees and records every UserOperation it sponsors, so all sweeps
 *   under one API key are grouped by the sponsor.
 *
 * Neither option provides anonymity; they trade different correlations.
 */
export type GasMode = 'self-funded' | 'sponsored';

export interface SweepResult {
  /** The submitted UserOperation hash. */
  userOpHash: `0x${string}`;
  /** The transaction that included it (available after inclusion). */
  transactionHash: `0x${string}`;
  /** The stealth address the funds moved from (= the UserOp sender). */
  from: `0x${string}`;
  /** The destination the user chose. */
  to: `0x${string}`;
  /** Amount swept, in wei. */
  value: bigint;
  /** How gas was paid. */
  gasMode: GasMode;
}

/**
 * Sweep a detected stealth payment to a destination the user chooses.
 *
 * Lifecycle:
 *   1. Reconstruct the stealth EOA from the detected stealth private key.
 *   2. Wrap it as an EIP-7702 account at the SAME address.
 *   3. Build a UserOperation moving the balance to `toAddress`.
 *   4. The relay fetches Paymaster sponsorship and gas prices (browser never
 *      talks to Pimlico).
 *   5. The stealth key signs the 7702 authorization and the UserOperation
 *      in the browser. No key material reaches the relay.
 *   6. The relay submits it to the bundler; EntryPoint executes it.
 *
 * @param payment   - Detected payment carrying the stealth private key
 * @param toAddress - Destination. NOT defaulted to the connected wallet:
 *                    that choice is the dominant on-chain correlation risk and
 *                    must be made explicitly by the user.
 * @param gasMode   - See {@link GasMode}. Defaults to 'sponsored'.
 */
export async function sponsoredSweep(
  payment: DetectedPayment,
  toAddress: `0x${string}`,
  gasMode: GasMode = 'sponsored',
): Promise<SweepResult> {
  if (!toAddress || !/^0x[0-9a-fA-F]{40}$/.test(toAddress)) {
    throw new Error('A valid destination address is required for the sweep.');
  }

  // 1-2. The stealth EOA, wrapped as an EIP-7702 account at the same address.
  const stealthSigner = privateKeyToAccount(payment.stealthPrivateKey);
  const { account, publicClient } = await createStealthSmartAccount(stealthSigner);

  // 3. Work out how much can move.
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) {
    throw new Error(`Stealth address ${account.address} has no balance to sweep.`);
  }

  // 4. Bundler (and, when sponsoring, the paymaster) — reached only via the relay.
  const pimlicoClient = createPimlicoClient({
    transport: relayBundlerTransport(),
    entryPoint: { address: ENTRYPOINT_ADDRESS, version: '0.8' },
  });

  const gasPrice = (await pimlicoClient.getUserOperationGasPrice()).fast;

  // Under sponsorship the account pays nothing, so the whole balance moves and
  // nothing is left behind. Self-funded, it must retain enough to prefund the
  // EntryPoint; `GAS_RESERVE_GAS` is a deliberately generous bound.
  const GAS_RESERVE_GAS = 400_000n;
  const gasReserve =
    gasMode === 'sponsored' ? 0n : GAS_RESERVE_GAS * (gasPrice.maxFeePerGas ?? 0n);

  if (gasMode === 'self-funded' && balance <= gasReserve) {
    throw new Error(
      `Stealth address holds ${balance} wei, which cannot cover its own gas ` +
        `(~${gasReserve} wei). Use gasMode 'sponsored' for this payment.`,
    );
  }
  const sweepAmount = balance - gasReserve;

  const smartAccountClient = createSmartAccountClient({
    account,
    chain: sepolia,
    bundlerTransport: relayBundlerTransport(),
    // No paymaster at all in self-funded mode: nothing to sponsor, nobody to
    // record the sponsorship.
    paymaster: gasMode === 'sponsored' ? pimlicoClient : undefined,
    userOperation: { estimateFeesPerGas: async () => gasPrice },
  });

  // 5. Sign the EIP-7702 authorization ourselves.
  //
  //    viem 2.56 / permissionless 0.4 do NOT do this. `prepareUserOperation`
  //    fills the authorization with fixed STUB r/s/yParity values so gas can be
  //    estimated, and nothing ever replaces them with a real signature — there
  //    is no `signAuthorization` call anywhere in viem's account-abstraction
  //    module or in permissionless. A bundler then recovers a garbage signer
  //    from the stub and rejects the operation with
  //    "The recovered signer address does not match the userOperation sender".
  //
  //    `prepareUserOperation` returns a caller-supplied `authorization` object
  //    verbatim, so signing it here fixes both estimation and submission.
  //
  //    The nonce is the account's own pending transaction count. It is NOT
  //    incremented: the bundler, not the stealth address, is the transaction
  //    executor, so the delegation applies at the account's current nonce.
  const authorizationNonce = await publicClient.getTransactionCount({
    address: account.address,
    blockTag: 'pending',
  });
  const authorization = await stealthSigner.signAuthorization({
    contractAddress: EIP7702_IMPLEMENTATION,
    chainId: sepolia.id,
    nonce: authorizationNonce,
  });

  // 6. Sign the UserOperation and submit via the relay, then wait for inclusion.
  const userOpHash = await smartAccountClient.sendUserOperation({
    calls: [{ to: toAddress, value: sweepAmount, data: '0x' }],
    authorization,
  });

  const receipt = await smartAccountClient.waitForUserOperationReceipt({
    hash: userOpHash,
  });

  return {
    userOpHash,
    transactionHash: receipt.receipt.transactionHash,
    from: account.address,
    to: toAddress,
    value: sweepAmount,
    gasMode,
  };
}

// ===========================================================
// Demo mode simulation
// ===========================================================

/**
 * Simulate a sweep. Returns an obviously-fake hash prefixed `0xDEMO`.
 *
 * NOTE: This executes NO transaction. Detection and derivation stay real;
 * only submission is simulated. Used when the relay is unconfigured, so the
 * app never silently falls back to a direct browser→Pimlico call.
 */
export async function simulateSweep(
  payment: DetectedPayment,
  toAddress: `0x${string}`,
): Promise<`0x${string}`> {
  await new Promise((r) => setTimeout(r, 2000));
  return `0xDEMO${payment.stealthAddress.slice(2, 10)}${toAddress.slice(2, 10)}${'0'.repeat(40)}` as `0x${string}`;
}

// ===========================================================
// Utility
// ===========================================================

export function formatEthBalance(balance: bigint): string {
  return parseFloat(formatEther(balance)).toFixed(6);
}
