/**
 * lib/smartAccount.ts
 * --------------------
 * Smart account creation and sponsored sweep via ERC-4337.
 *
 * Architecture:
 *   EOA signer → Kernel v3 Smart Account → UserOperation → Pimlico Bundler
 *                                                                ↑
 *                                                     Paymaster sponsors gas
 *
 * WHY ACCOUNT ABSTRACTION HERE:
 *   Sweeping funds from a stealth address requires gas AT that address.
 *   Funding it from a known wallet would re-link it, destroying privacy.
 *   The Paymaster pays the gas so the stealth address never needs ETH from
 *   a known source — this is the entire reason AA is used in StealthTag.
 *
 * We use:
 *   - permissionless.js for the smart account + UserOperation construction
 *   - Pimlico for the bundler and verifying paymaster
 *   - Kernel v3 (ZeroDev) as the smart account implementation
 */

import { createSmartAccountClient } from 'permissionless';
import { toKernelSmartAccount } from 'permissionless/accounts';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { entryPoint07Address } from 'viem/account-abstraction';
import {
  createPublicClient,
  http,
  parseEther,
  formatEther,
  type Account,
  type LocalAccount,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { getPimlicoUrl, isDemoMode } from './chain';
import type { DetectedPayment } from '@/types';

// ===========================================================
// Smart Account Setup (recipient side)
// ===========================================================

/**
 * Create a Kernel v3 smart account for the given signer.
 *
 * The smart account address is deterministic — it's derived from the
 * signer address. The account doesn't need to be deployed before first use
 * (the bundler handles counterfactual deployment on first UserOp).
 *
 * @param signerAccount - The EOA account (from wagmi's walletClient.account or privateKeyToAccount)
 * @param rpcUrl        - Sepolia RPC URL
 * @param pimlicoApiKey - Pimlico API key
 */
export async function createKernelSmartAccount(
  signerAccount: LocalAccount,
  rpcUrl: string,
  pimlicoApiKey: string,
) {
  const pimlicoUrl = getPimlicoUrl(pimlicoApiKey);

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  const pimlicoClient = createPimlicoClient({
    transport: http(pimlicoUrl),
    entryPoint: {
      address: entryPoint07Address,
      version: '0.7',
    },
  });

  // Create Kernel v3 smart account
  const kernelAccount = await toKernelSmartAccount({
    client: publicClient,
    entryPoint: {
      address: entryPoint07Address,
      version: '0.7',
    },
    owners: [signerAccount],
    version: '0.3.1',
  });

  // Create the smart account client with paymaster
  const smartAccountClient = createSmartAccountClient({
    account: kernelAccount,
    chain: sepolia,
    bundlerTransport: http(pimlicoUrl),
    paymaster: pimlicoClient,
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast;
      },
    },
  });

  return {
    smartAccountClient,
    smartAccountAddress: kernelAccount.address,
    kernelAccount,
  };
}

/**
 * Get the counterfactual smart account address for a signer.
 * This is deterministic and doesn't require an on-chain transaction.
 */
export async function getSmartAccountAddress(
  signerAccount: LocalAccount,
  rpcUrl: string,
  pimlicoApiKey: string,
): Promise<`0x${string}`> {
  try {
    const { smartAccountAddress } = await createKernelSmartAccount(
      signerAccount,
      rpcUrl,
      pimlicoApiKey,
    );
    return smartAccountAddress;
  } catch {
    // Fallback for demo mode or missing config
    return '0x0000000000000000000000000000000000000000';
  }
}

// ===========================================================
// Sponsored Sweep (recipient side)
// ===========================================================

/**
 * Sweep funds from a detected stealth address to the recipient's wallet.
 *
 * This is the core AA use case in StealthTag:
 *   1. We use the stealth address's private key to sign a UserOperation
 *   2. The UserOperation transfers funds to the recipient's smart account / wallet
 *   3. The Pimlico Paymaster SPONSORS the gas — so the stealth address
 *      never needs to be funded from a known wallet
 *
 * The sweep executes as:
 *   Stealth key (signer) → UserOperation → Bundler → EntryPoint → transfer
 *
 * @param payment       - The detected payment to sweep
 * @param toAddress     - Destination address (recipient's smart account or EOA)
 * @param rpcUrl        - Sepolia RPC URL
 * @param pimlicoApiKey - Pimlico bundler + paymaster API key
 */
export async function sponsoredSweep(
  payment: DetectedPayment,
  toAddress: `0x${string}`,
  rpcUrl: string,
  pimlicoApiKey: string,
): Promise<`0x${string}`> {
  if (isDemoMode()) {
    throw new Error('DEMO_MODE: Use simulateSweep instead');
  }

  // The stealth address's private key is the signer for this UserOperation
  const stealthSigner = privateKeyToAccount(payment.stealthPrivateKey);

  // Create a Kernel smart account using the stealth key as signer
  // This creates a counterfactual smart account at the stealth address
  const { smartAccountClient } = await createKernelSmartAccount(
    stealthSigner,
    rpcUrl,
    pimlicoApiKey,
  );

  // Get balance of the stealth address
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  const balance = await publicClient.getBalance({ address: payment.stealthAddress });

  if (balance === 0n) {
    throw new Error('Stealth address has no balance to sweep');
  }

  // The paymaster covers gas so we can sweep full balance
  const sweepAmount = balance;

  // Execute the sweep as a sponsored UserOperation
  // The Paymaster pays the gas — the stealth address is NOT funded with ETH for gas
  const txHash = await smartAccountClient.sendTransaction({
    to: toAddress,
    value: sweepAmount,
    data: '0x',
  });

  return txHash as `0x${string}`;
}

// ===========================================================
// Demo mode simulation
// ===========================================================

/**
 * Simulate a sweep transaction for demo mode.
 *
 * Returns a fake tx hash and clearly marks it as simulated.
 * Use this when the bundler/Paymaster is unavailable.
 *
 * NOTE: This does NOT execute a real transaction.
 * The stealth derivation and detection remain real; only the sweep is simulated.
 */
export async function simulateSweep(
  payment: DetectedPayment,
  toAddress: `0x${string}`,
): Promise<`0x${string}`> {
  // Simulate network delay
  await new Promise((r) => setTimeout(r, 2000));

  // Return a deterministic fake hash for demo purposes
  const fakeHash =
    `0xDEMO${payment.stealthAddress.slice(2, 10)}${toAddress.slice(2, 10)}${'0'.repeat(40)}` as `0x${string}`;

  return fakeHash;
}

// ===========================================================
// Utility
// ===========================================================

/**
 * Format an ETH balance for display.
 */
export function formatEthBalance(balance: bigint): string {
  return parseFloat(formatEther(balance)).toFixed(6);
}
