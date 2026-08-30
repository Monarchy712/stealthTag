/**
 * lib/wagmi.ts
 * -------------
 * wagmi + RainbowKit configuration for StealthTag.
 *
 * WalletConnect is OPTIONAL.
 *
 * `getDefaultConfig` requires a real WalletConnect Cloud projectId and wires up
 * the WalletConnect connector unconditionally. With a placeholder id that
 * connector fails at runtime, which used to break the wallet picker for
 * everyone — including people using MetaMask, who need no WalletConnect at all.
 *
 * So: if a projectId is configured we use the full default set. If it is not,
 * we fall back to injected-only wallets (MetaMask, Rabby, Brave, …), which need
 * no third-party project. The app stays fully usable either way, and an empty
 * or missing env var degrades instead of crashing.
 */

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { createConfig, http } from 'wagmi';
import { injected, safe } from 'wagmi/connectors';
import { sepolia } from 'wagmi/chains';
import { relayUrl } from './relay';

/**
 * Read an env var, treating the empty string as absent.
 * `??` is wrong here: an unset key in `.env.local` arrives as `''`, which is
 * not nullish, so `??` would hand the empty string straight through.
 */
function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

/**
 * All wagmi reads go through the relay, NOT straight to a public RPC endpoint.
 *
 * Two reasons, both real:
 *  1. PRIVACY. A direct browser→RPC transport hands the provider the user's IP
 *     alongside every address the app reads — the exact correlation the relay
 *     exists to remove. `hooks/useScanner` was already relayed; wagmi was not,
 *     so the app was leaking through a side door.
 *  2. CORRECTNESS. Public endpoints such as rpc.sepolia.org send no
 *     Access-Control-Allow-Origin header, so browser fetches to them fail CORS
 *     preflight and every wagmi read errored in the console.
 *
 * The relay is same-origin, so no CORS is involved at all.
 */
const rpcUrl = relayUrl('rpc');

/** Empty unless the operator supplies a real WalletConnect Cloud projectId. */
const walletConnectProjectId = env('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID', '');

/** True when WalletConnect (and therefore mobile/QR wallets) is available. */
export const walletConnectEnabled = walletConnectProjectId.length > 0;

const APP_NAME = 'StealthTag';

export const wagmiConfig = walletConnectEnabled
  ? getDefaultConfig({
      appName: APP_NAME,
      projectId: walletConnectProjectId,
      chains: [sepolia],
      transports: { [sepolia.id]: http(rpcUrl) },
      ssr: true,
    })
  : createConfig({
      // wagmi's own connectors, not RainbowKit's wallet list: RainbowKit's
      // metaMaskWallet / rainbowWallet pull in WalletConnect and throw
      // "No projectId found" at module-evaluation time, which fails the
      // production build during prerender. `injected` covers MetaMask, Rabby,
      // Brave and every other extension wallet with no third party involved.
      // RainbowKit's ConnectButton renders these connectors fine.
      connectors: [injected({ shimDisconnect: true }), safe()],
      chains: [sepolia],
      transports: { [sepolia.id]: http(rpcUrl) },
      ssr: true,
    });
