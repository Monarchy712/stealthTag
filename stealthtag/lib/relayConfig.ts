/**
 * lib/relayConfig.ts
 * -------------------
 * Shared configuration for the StealthTag relay — the single place that
 * defines what the relay is allowed to forward.
 *
 * Imported by BOTH the server route (app/api/relay/[target]/route.ts) and the
 * client (lib/relay.ts), so it must stay free of server-only imports and free
 * of secrets.
 *
 * WHAT THE RELAY IS
 * -----------------
 * A server-side JSON-RPC proxy that sits between the user's browser and the
 * ERC-4337 / RPC infrastructure. It is a NETWORK privacy boundary and an API
 * key boundary. It is NOT an anonymity system:
 *
 *   - It hides the user's IP from Pimlico and the RPC provider.
 *   - It keeps the Pimlico API key on the server instead of in the browser.
 *   - It does NOT hide anything from ITSELF. The relay operator sees the
 *     user's IP, the stealth addresses queried, the UserOperation, its
 *     destination, and the timing. Trust simply moves from Pimlico to the
 *     relay operator.
 *   - It changes NOTHING on-chain. On-chain correlation is unaffected.
 *
 * See PRIVACY.md for the full actor-by-actor analysis.
 */

/** Upstreams the relay will proxy to. */
export type RelayTarget = 'bundler' | 'rpc';

export const RELAY_TARGETS: readonly RelayTarget[] = ['bundler', 'rpc'] as const;

export function isRelayTarget(value: string): value is RelayTarget {
  return (RELAY_TARGETS as readonly string[]).includes(value);
}

/**
 * Methods the relay forwards to the bundler/paymaster (Pimlico).
 *
 * Deliberately an allowlist, not a denylist: the relay must never become an
 * open proxy for the API key it holds. Everything needed to build, sponsor,
 * submit and track a sponsored UserOperation is here, and nothing else.
 */
export const ALLOWED_BUNDLER_METHODS: readonly string[] = [
  // ERC-4337 bundler
  'eth_chainId',
  'eth_supportedEntryPoints',
  'eth_estimateUserOperationGas',
  'eth_sendUserOperation',
  'eth_getUserOperationByHash',
  'eth_getUserOperationReceipt',
  // ERC-7677 paymaster
  'pm_getPaymasterStubData',
  'pm_getPaymasterData',
  'pm_sponsorUserOperation',
  'pm_getPaymasterErc20Data',
  // Pimlico extensions used by permissionless.js
  'pimlico_getUserOperationGasPrice',
  'pimlico_getUserOperationStatus',
  'pimlico_sponsorUserOperation',
] as const;

/**
 * Methods the relay forwards to the plain JSON-RPC node.
 *
 * Read-only. Scanning is the reason this exists: without it the browser asks a
 * public RPC provider for the balance of exactly the set of stealth addresses
 * belonging to one viewing key, which is a strong correlation signal.
 *
 * `eth_sendRawTransaction` is intentionally ABSENT — the relay never forwards
 * a raw signed transaction, only UserOperations via the bundler path.
 */
export const ALLOWED_RPC_METHODS: readonly string[] = [
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_getCode',
  'eth_getLogs',
  'eth_call',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_getBlockByNumber',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
] as const;

export function allowedMethodsFor(target: RelayTarget): readonly string[] {
  return target === 'bundler' ? ALLOWED_BUNDLER_METHODS : ALLOWED_RPC_METHODS;
}

export function isMethodAllowed(target: RelayTarget, method: string): boolean {
  return allowedMethodsFor(target).includes(method);
}

/** Client-side path for a relay target. Same-origin, so no CORS and no
 *  third-party host appears in the browser's connection list. */
export function relayPath(target: RelayTarget): string {
  return `/api/relay/${target}`;
}

/** Max JSON-RPC batch size the relay accepts, to bound abuse of the API key. */
export const MAX_BATCH_SIZE = 20;

/** Upstream request timeout (ms). */
export const RELAY_TIMEOUT_MS = 30_000;
