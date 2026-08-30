/**
 * lib/relay.ts
 * -------------
 * Client-side access to the StealthTag relay.
 *
 * Every call the recipient makes that could correlate them — scanning for
 * announcements, reading stealth-address balances, estimating/sponsoring/
 * submitting the sweep UserOperation — goes through the same-origin relay
 * route instead of straight to Pimlico or a public RPC provider.
 *
 * Honest scope, repeated because it matters:
 *   - hides the browser's IP from Pimlico and the RPC node          ✅
 *   - keeps the Pimlico API key out of the browser bundle           ✅
 *   - hides anything from the relay operator                        ❌
 *   - changes anything visible on-chain                             ❌
 *   - provides anonymity                                            ❌
 */

import { http, type Transport } from 'viem';
import { relayPath, type RelayTarget } from './relayConfig';

/**
 * Absolute relay URL. In the browser a relative path is enough; on the server
 * (SSR, tests, scripts) viem needs an absolute URL, so fall back to an
 * explicit base.
 */
export function relayUrl(target: RelayTarget): string {
  const path = relayPath(target);
  if (typeof window !== 'undefined') return path;
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.PORT ? `http://localhost:${process.env.PORT}` : 'http://localhost:3000');
  return `${base}${path}`;
}

/** viem transport for the ERC-4337 bundler + paymaster, via the relay. */
export function relayBundlerTransport(): Transport {
  return http(relayUrl('bundler'), { timeout: 30_000 });
}

/** viem transport for plain JSON-RPC reads, via the relay. */
export function relayRpcTransport(): Transport {
  return http(relayUrl('rpc'), { timeout: 30_000 });
}

/**
 * Whether relayed sweeping is available.
 *
 * The client cannot see PIMLICO_API_KEY (that is the point), so it asks the
 * relay. A `false` here means the app must stay in demo mode rather than
 * silently falling back to a direct browser→Pimlico call, which is exactly the
 * correlation the relay exists to remove.
 */
export async function isRelayConfigured(target: RelayTarget = 'bundler'): Promise<boolean> {
  try {
    const res = await fetch(relayUrl(target), { method: 'GET', cache: 'no-store' });
    if (!res.ok) return false;
    const body = (await res.json()) as { configured?: boolean };
    return body.configured === true;
  } catch {
    return false;
  }
}
