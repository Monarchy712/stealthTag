/**
 * lib/wagmi.ts
 * -------------
 * wagmi + RainbowKit configuration for StealthTag.
 */

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';
import { http } from 'wagmi';

const rpcUrl =
  process.env.NEXT_PUBLIC_RPC_URL ?? 'https://rpc.sepolia.org';

export const wagmiConfig = getDefaultConfig({
  appName: 'StealthTag',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? 'DEMO_PROJECT_ID',
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(rpcUrl),
  },
  ssr: true,
});
