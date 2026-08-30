'use client';

/**
 * app/send/page.tsx — Sender flow
 *
 * Steps:
 *  1. Paste recipient's handle (meta-address or EOA to resolve from registry)
 *  2. Derive a one-time stealth address (ECDH via ERC-5564 SDK)
 *  3. Enter amount and send ETH to that address
 *  4. Publish announcement to ERC-5564 Announcer
 */

import { useState } from 'react';
import { useAccount, useWalletClient, usePublicClient, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { parseEther, isAddress } from 'viem';
import {
  ArrowRight,
  CheckCircle2,
  Megaphone,
  RefreshCw,
  Send,
  Shuffle,
  Wallet,
} from 'lucide-react';
import {
  AlertBox,
  Badge,
  Button,
  Card,
  Divider,
  SectionHeading,
  StepNumber,
  TxStatusBadge,
} from '@/components/ui';
import { deriveStealthAddress, parseMetaAddress } from '@/lib/stealth';
import { resolveMetaAddress } from '@/lib/registry';
import { publishAnnouncement } from '@/lib/announcer';
import type { DerivedStealthAddress, TxState } from '@/types';

export default function SendPage() {
  const { isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [handle, setHandle] = useState('');
  const [amount, setAmount] = useState('0.001');
  const [resolvedMeta, setResolvedMeta] = useState<string | null>(null);
  const [derived, setDerived] = useState<DerivedStealthAddress | null>(null);
  const [resolveState, setResolveState] = useState<TxState>({ status: 'idle' });
  const [sendState, setSendState] = useState<TxState>({ status: 'idle' });
  const [announceState, setAnnounceState] = useState<TxState>({ status: 'idle' });

  // --- Step 1: resolve + derive ---
  async function handleResolveAndDerive() {
    setResolveState({ status: 'pending' });
    setDerived(null);
    setResolvedMeta(null);

    try {
      let meta: string | null = null;

      if (handle.startsWith('st:eth:') || handle.startsWith('0x04')) {
        // Direct meta-address paste
        meta = handle.startsWith('0x') ? `st:eth:${handle}` : handle;
      } else if (isAddress(handle)) {
        // EOA address — look up registry
        meta = await resolveMetaAddress(handle as `0x${string}`, publicClient as any);
        if (!meta) {
          setResolveState({
            status: 'failed',
            error: `Address ${handle} has not registered a StealthTag. Ask them to set up at /setup.`,
          });
          return;
        }
      } else {
        setResolveState({
          status: 'failed',
          error: 'Enter a valid stealth meta-address (st:eth:0x...) or an Ethereum address.',
        });
        return;
      }

      // Derive a fresh one-time stealth address using ECDH (ERC-5564 SDK)
      const derivedAddr = deriveStealthAddress(meta);
      setResolvedMeta(meta);
      setDerived(derivedAddr);
      setResolveState({ status: 'confirmed' });
    } catch (err: any) {
      setResolveState({
        status: 'failed',
        error: `Failed to resolve: ${err?.message ?? 'Unknown error'}`,
      });
    }
  }

  // --- Step 2: Send ETH to stealth address ---
  const { sendTransactionAsync } = useSendTransaction();

  async function handleSend() {
    if (!derived || !walletClient) return;
    setSendState({ status: 'pending' });
    try {
      const hash = await sendTransactionAsync({
        to: derived.stealthAddress,
        value: parseEther(amount),
      });
      setSendState({ status: 'confirmed', hash });
    } catch (err: any) {
      setSendState({
        status: 'failed',
        error: err?.message?.includes('rejected')
          ? 'Transaction rejected'
          : err?.message ?? 'Send failed',
      });
    }
  }

  // --- Step 3: Announce ---
  async function handleAnnounce() {
    if (!derived || !walletClient || sendState.status !== 'confirmed') return;
    setAnnounceState({ status: 'pending' });
    try {
      const hash = await publishAnnouncement(
        walletClient,
        derived.stealthAddress,
        derived.ephemeralPublicKey,
        derived.viewTag,
      );
      setAnnounceState({ status: 'confirmed', hash });
    } catch (err: any) {
      setAnnounceState({
        status: 'failed',
        error: err?.message ?? 'Announcement failed',
      });
    }
  }

  // Rederive a fresh address (each call is unique — different ephemeral key)
  function handleRederive() {
    if (!resolvedMeta) return;
    try {
      const newDerived = deriveStealthAddress(resolvedMeta);
      setDerived(newDerived);
      setSendState({ status: 'idle' });
      setAnnounceState({ status: 'idle' });
    } catch {}
  }

  if (!isConnected) {
    return (
      <PageShell>
        <div className="flex flex-col items-center gap-6 py-24">
          <Wallet className="w-12 h-12 text-gray-600" />
          <p className="text-gray-400">Connect your wallet to send an unlinkable payment</p>
          <ConnectButton />
        </div>
      </PageShell>
    );
  }

  const canSend = derived && resolveState.status === 'confirmed';
  const canAnnounce = sendState.status === 'confirmed' && derived;
  const allDone = announceState.status === 'confirmed';

  return (
    <PageShell>
      <SectionHeading
        badge="ERC-5564 Stealth Send"
        title="Pay a StealthTag handle"
        subtitle="One action: resolve handle → derive a one-time address → send → announce."
      />

      {/* Explainer */}
      <AlertBox type="info">
        Each payment derives a <strong>fresh, unique one-time address</strong> from the recipient&apos;s
        handle via ECDH (ERC-5564). Even if you pay the same handle twice, the two stealth
        addresses are different — and unlinked on-chain.
      </AlertBox>

      <div className="space-y-4 mt-6">
        {/* ── Step 1: Resolve ──────────────────────────────── */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <StepNumber n={1} />
            <h3 className="font-bold text-white">Enter recipient handle</h3>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="st:eth:0x... or 0x (EOA address with registered StealthTag)"
              className="flex-1 bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-indigo-600 font-mono"
            />
            <Button
              onClick={handleResolveAndDerive}
              loading={resolveState.status === 'pending'}
              disabled={!handle.trim()}
            >
              Resolve
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
          {resolveState.status === 'failed' && (
            <p className="text-red-400 text-xs mt-2">{resolveState.error}</p>
          )}
        </Card>

        {/* ── Step 2: Derived address ──────────────────────── */}
        {derived && (
          <Card className="border-indigo-800/40">
            <div className="flex items-center gap-3 mb-4">
              <StepNumber n={2} />
              <h3 className="font-bold text-white">One-time stealth address derived</h3>
            </div>

            <div className="bg-gray-950 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-xs text-gray-500 mb-1">One-time stealth address <Badge variant="info">fresh per payment</Badge></p>
                <p className="font-mono text-sm text-indigo-300 break-all">{derived.stealthAddress}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-gray-500 mb-0.5">Ephemeral public key (published in announcement)</p>
                  <p className="font-mono text-gray-500 break-all">{derived.ephemeralPublicKey.slice(0, 20)}…</p>
                </div>
                <div>
                  <p className="text-gray-500 mb-0.5">View tag (1 byte, for 256× scan speedup)</p>
                  <p className="font-mono text-gray-300">{String(derived.viewTag)}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={handleRederive}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                Derive a different address
              </button>
              <span className="text-xs text-gray-600">(every call produces a unique address)</span>
            </div>

            <Divider label="Send funds" />

            <div className="flex gap-2 items-center mb-3">
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">Amount (ETH)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0.0001"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={sendState.status === 'confirmed'}
                  className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-indigo-600"
                />
              </div>
              <Button
                onClick={handleSend}
                loading={sendState.status === 'pending'}
                disabled={sendState.status === 'confirmed' || !amount}
                className="mt-5"
              >
                <Send className="w-4 h-4" />
                {sendState.status === 'confirmed' ? 'Sent ✓' : 'Send ETH'}
              </Button>
            </div>
            <TxStatusBadge state={sendState} />
          </Card>
        )}

        {/* ── Step 3: Announce ─────────────────────────────── */}
        {canAnnounce && (
          <Card className="border-violet-800/40">
            <div className="flex items-center gap-3 mb-4">
              <StepNumber n={3} />
              <h3 className="font-bold text-white">Announce the payment</h3>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              Publish the ephemeral public key + view tag to the ERC-5564 Announcer contract.
              This lets the recipient&apos;s scanner detect the payment without revealing who it&apos;s for.
            </p>
            <Button
              onClick={handleAnnounce}
              loading={announceState.status === 'pending'}
              disabled={announceState.status === 'confirmed'}
              className="w-full"
            >
              <Megaphone className="w-4 h-4" />
              {announceState.status === 'confirmed' ? 'Announced ✓' : 'Publish announcement'}
            </Button>
            <div className="mt-3">
              <TxStatusBadge state={announceState} />
            </div>
          </Card>
        )}

        {/* ── Done ─────────────────────────────────────────── */}
        {allDone && (
          <Card className="border-emerald-800/40 bg-emerald-950/20">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-white mb-1">Payment sent unlinkably ✓</h3>
                <p className="text-sm text-gray-400">
                  The recipient will detect this payment in their scanner using their viewing key.
                  From an on-chain observer&apos;s perspective, this is just a transfer to a random address.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Badge variant="success">Funds delivered</Badge>
                  <Badge variant="success">Announcement published</Badge>
                  <Badge variant="info">Recipient can detect + sweep</Badge>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="max-w-3xl mx-auto px-4 py-12">{children}</div>;
}
