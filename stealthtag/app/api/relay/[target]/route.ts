/**
 * app/api/relay/[target]/route.ts
 * --------------------------------
 * The StealthTag relay: a server-side JSON-RPC proxy to the ERC-4337
 * bundler/paymaster (Pimlico) and to a plain Ethereum RPC node.
 *
 * WHY IT EXISTS
 * -------------
 * Without it, the browser talks to Pimlico and to the RPC provider directly.
 * Those providers then see, in one place:
 *   - the user's IP address
 *   - the stealth addresses being scanned (getBalance / getLogs)
 *   - the UserOperation: sender (= stealth address), destination, amount
 *   - the timing of all of it
 * which groups every stealth address belonging to one recipient behind one IP.
 *
 * With it, the upstream sees only this server. That is a real, if narrow,
 * improvement — and it is the ONLY privacy property this file provides.
 *
 * WHAT IT IS NOT
 * --------------
 * NOT an anonymity system. The relay operator sees everything the upstream
 * used to see. Trust moves, it does not disappear. And nothing here changes
 * what is visible on-chain. See PRIVACY.md.
 *
 * WHAT IT NEVER HANDLES
 * ---------------------
 * Private keys. UserOperations arrive already signed by the stealth key, which
 * never leaves the browser. The relay cannot spend user funds, cannot modify a
 * signed UserOperation without invalidating its signature, and cannot derive
 * any stealth key. Asserted by scripts/test-relay.ts.
 */

import { NextResponse } from 'next/server';
import {
  MAX_BATCH_SIZE,
  RELAY_TIMEOUT_MS,
  isMethodAllowed,
  isRelayTarget,
  type RelayTarget,
} from '@/lib/relayConfig';

/** Node runtime: the API key must never be shipped to the edge/client bundle. */
export const runtime = 'nodejs';
/** Never cache a relayed RPC response. */
export const dynamic = 'force-dynamic';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

/**
 * Resolve the upstream URL for a target.
 *
 * Reads SERVER-ONLY env vars. `PIMLICO_API_KEY` has no NEXT_PUBLIC_ prefix, so
 * Next.js will not inline it into the client bundle — unlike the previous
 * NEXT_PUBLIC_PIMLICO_API_KEY, which was readable by anyone loading the page.
 */
function resolveUpstream(target: RelayTarget): { url: string } | { error: string } {
  if (target === 'bundler') {
    const apiKey = process.env.PIMLICO_API_KEY;
    if (!apiKey || apiKey.length < 10) {
      return {
        error:
          'Relay is not configured: set PIMLICO_API_KEY (server-side, no NEXT_PUBLIC_ prefix) to enable sponsored sweeps.',
      };
    }
    const chain = process.env.PIMLICO_CHAIN ?? 'sepolia';
    return { url: `https://api.pimlico.io/v2/${chain}/rpc?apikey=${apiKey}` };
  }

  const rpcUrl = process.env.RELAY_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL;
  if (!rpcUrl) {
    return {
      error: 'Relay is not configured: set RELAY_RPC_URL to enable relayed RPC access.',
    };
  }
  return { url: rpcUrl };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/**
 * Validate one JSON-RPC call against the target's allowlist.
 * The relay holds an API key, so it must never act as an open proxy.
 */
function validateCall(
  target: RelayTarget,
  call: JsonRpcRequest,
): { ok: true } | { ok: false; response: ReturnType<typeof rpcError> } {
  if (typeof call?.method !== 'string') {
    return { ok: false, response: rpcError(call?.id, -32600, 'Invalid request: missing method') };
  }
  if (!isMethodAllowed(target, call.method)) {
    return {
      ok: false,
      response: rpcError(
        call.id,
        -32601,
        `Method not relayed: ${call.method} is not on the ${target} allowlist`,
      ),
    };
  }
  return { ok: true };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ target: string }> },
) {
  const { target: rawTarget } = await context.params;

  if (!isRelayTarget(rawTarget)) {
    return NextResponse.json(rpcError(null, -32601, `Unknown relay target: ${rawTarget}`), {
      status: 404,
    });
  }
  const target: RelayTarget = rawTarget;

  let body: JsonRpcRequest | JsonRpcRequest[];
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400 });
  }

  const calls = Array.isArray(body) ? body : [body];

  if (calls.length === 0) {
    return NextResponse.json(rpcError(null, -32600, 'Empty batch'), { status: 400 });
  }
  if (calls.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      rpcError(null, -32600, `Batch too large: ${calls.length} > ${MAX_BATCH_SIZE}`),
      { status: 400 },
    );
  }

  for (const call of calls) {
    const verdict = validateCall(target, call);
    if (!verdict.ok) {
      return NextResponse.json(Array.isArray(body) ? [verdict.response] : verdict.response, {
        status: 403,
      });
    }
  }

  const upstream = resolveUpstream(target);
  if ('error' in upstream) {
    return NextResponse.json(rpcError(calls[0]?.id, -32000, upstream.error), { status: 503 });
  }

  // Forward with a fresh header set. Nothing from the caller's request is
  // passed on — no cookies, no Referer, no User-Agent, no forwarded-for — so
  // the upstream cannot attribute the call to the browser that originated it.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(upstream.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });

    const text = await upstreamResponse.text();

    // Pass the payload through verbatim so JSON-RPC error objects reach the
    // client intact, but never leak upstream headers back to the browser.
    return new NextResponse(text, {
      status: upstreamResponse.status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch (err: unknown) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return NextResponse.json(
      rpcError(
        calls[0]?.id,
        -32000,
        aborted ? 'Relay upstream timed out' : 'Relay upstream request failed',
      ),
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** Health/inspection endpoint. Never reveals the API key or the upstream URL. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ target: string }> },
) {
  const { target: rawTarget } = await context.params;
  if (!isRelayTarget(rawTarget)) {
    return NextResponse.json({ error: `Unknown relay target: ${rawTarget}` }, { status: 404 });
  }
  const upstream = resolveUpstream(rawTarget);
  return NextResponse.json({
    target: rawTarget,
    configured: !('error' in upstream),
    note: 'The relay hides the client IP from the upstream. It does NOT provide anonymity — the relay operator sees the same data the upstream would. See PRIVACY.md.',
  });
}
