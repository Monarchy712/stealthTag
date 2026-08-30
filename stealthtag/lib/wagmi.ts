/**
 * lib/wagmi.ts
 * -------------
 * wagmi + RainbowKit configuration for StealthTag.
 */

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';
import { http } from 'wagmi';

/** `??` is wrong for env vars: an unset var in .env.local arrives as the empty
 *  string, which is not nullish, so the fallback would be skipped and
 *  RainbowKit would throw "No projectId found" during prerender. Treat empty
 *  as absent. */
function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

const rpcUrl = env('NEXT_PUBLIC_RPC_URL', 'https://rpc.sepolia.org');

export const wagmiConfig = getDefaultConfig({
  appName: 'StealthTag',
  projectId: env('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID', 'DEMO_PROJECT_ID'),
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(rpcUrl),
  },
  ssr: true,
});
