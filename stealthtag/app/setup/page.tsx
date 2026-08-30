'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Key,
  RefreshCw,
  Shield,
  Wallet,
} from 'lucide-react';
import {
  AlertBox,
  Badge,
  Button,
  Card,
  Divider,
  SectionHeading,
  Spinner,
  StepNumber,
  TxStatusBadge,
} from '@/components/ui';
import { useStealthKeys } from '@/hooks/useStealthKeys';
import { registerMetaAddress } from '@/lib/registry';
import { useWalletClient, usePublicClient } from 'wagmi';
import type { TxState } from '@/types';

export default function SetupPage() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { keyBundle, publicBundle, keyState, error: keyError, generateKeys, lockKeys } =
    useStealthKeys();

  const [passphrase, setPassphrase] = useState('');

  const [regState, setRegState] = useState<TxState>({ status: 'idle' });
  const [copied, setCopied] = useState(false);

  async function handleRegister() {
    if (!walletClient || !publicBundle) return;
    setRegState({ status: 'pending' });
    try {
      const hash = await registerMetaAddress(walletClient, publicBundle.metaAddress);
      setRegState({ status: 'confirmed', hash });
    } catch (err: any) {
      setRegState({ status: 'failed', error: err?.message ?? 'Registration failed' });
    }
  }

  function copyMeta() {
    if (!publicBundle) return;
    navigator.clipboard.writeText(publicBundle.metaAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!isConnected) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center py-24 gap-6">
          <Wallet className="w-12 h-12 text-gray-600" />
          <h2 className="text-xl font-bold text-white">Connect your wallet</h2>
          <p className="text-gray-400 text-sm text-center max-w-sm">
            Connect your wallet to generate your stealth meta-address and get your StealthTag handle.
          </p>
          <ConnectButton />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <SectionHeading
        badge="ERC-5564 + ERC-6538"
        title="Set up your StealthTag"
        subtitle="Generate your stealth meta-address and register it on-chain. Share it like any payment handle."
      />

      {/* Address distinctions — educational */}
      <AddressDistinctionPanel address={address!} publicBundle={publicBundle} />

      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        {/* Step 1: Generate keys */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <StepNumber n={1} />
            <div>
              <h3 className="font-bold text-white">Generate stealth keys</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                One wallet signature + your passphrase → spending & viewing keys
              </p>
            </div>
          </div>

          {(keyState === 'not_generated' || keyState === 'error') && (
            <AlertBox type="info">
              You&apos;ll sign one message with your wallet and choose a passphrase.
              No funds are at risk — the signature only moves data. Both inputs are
              required: the signature alone cannot reconstruct your stealth keys, so
              a malicious site that tricks you into signing cannot derive them.
              The same wallet + same passphrase always regenerates the same keys.
            </AlertBox>
          )}

          {keyState === 'locked' && (
            <AlertBox type="info">
              <p className="font-medium mb-1">Keys locked</p>
              <p className="text-xs opacity-80">
                Your meta-address is stored on this device, but the private keys are
                not — they are never written to disk. Enter your passphrase and sign
                once to unlock scanning and sweeping for this session.
              </p>
            </AlertBox>
          )}

          {keyState === 'generated' && keyBundle && (
            <div className="space-y-3 mb-4">
              <AlertBox type="success">
                <p className="font-medium mb-2">Keys generated ✓</p>
                <p className="text-xs opacity-80">
                  Your spending key and viewing key are ready. The viewing key
                  lets you detect payments; the spending key lets you sweep them.
                  The two are separate so you can share the viewing key for auditing
                  without giving spending ability.
                </p>
              </AlertBox>

              <div className="bg-gray-950 rounded-xl p-3 space-y-2">
                <KeyRow
                  label="Spending pubkey"
                  value={keyBundle.spendingPublicKey}
                  sensitive
                />
                <KeyRow
                  label="Viewing pubkey"
                  value={keyBundle.viewingPublicKey}
                  sensitive={false}
                />
              </div>
            </div>
          )}

          {keyError && (
            <AlertBox type="error" title="Key generation failed">
              {keyError}
            </AlertBox>
          )}

          <div className="mt-4">
            <label
              htmlFor="stealth-passphrase"
              className="block text-xs text-gray-500 mb-1"
            >
              StealthTag passphrase
            </label>
            <input
              id="stealth-passphrase"
              type="password"
              autoComplete="off"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Never leaves this device"
              className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-sm
                         text-gray-200 font-mono placeholder:text-gray-700 focus:outline-none
                         focus:border-indigo-600"
            />
            <p className="text-[11px] text-gray-600 mt-1.5 leading-relaxed">
              Lose this and you lose access to funds at your stealth addresses — it is
              half of the key material. It is never sent anywhere and never stored.
            </p>
          </div>

          <Button
            onClick={() => generateKeys(passphrase)}
            loading={keyState === 'generating'}
            disabled={keyState === 'generating' || passphrase.length === 0}
            className="mt-3 w-full"
          >
            <Key className="w-4 h-4" />
            {keyState === 'generating'
              ? 'Waiting for signature…'
              : keyState === 'generated'
              ? 'Re-derive keys'
              : keyState === 'locked'
              ? 'Unlock keys'
              : 'Derive stealth keys'}
          </Button>

          {keyState === 'generated' && (
            <button
              onClick={() => {
                setPassphrase('');
                lockKeys();
              }}
              className="mt-2 w-full text-xs text-gray-600 hover:text-gray-400"
            >
              Lock keys (clear private keys from memory)
            </button>
          )}
        </Card>

        {/* Step 2: Meta-address + Register */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <StepNumber n={2} />
            <div>
              <h3 className="font-bold text-white">Your stealth meta-address</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Register it on-chain so senders can find it
              </p>
            </div>
          </div>

          {!publicBundle ? (
            <div className="text-center py-8 text-gray-600 text-sm">
              Complete Step 1 first
            </div>
          ) : (
            <>
              <div className="bg-gray-950 rounded-xl p-3 mb-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 mb-1">Your handle (meta-address)</p>
                    <p className="font-mono text-xs text-indigo-300 break-all leading-relaxed">
                      {publicBundle.metaAddress}
                    </p>
                  </div>
                  <button
                    onClick={copyMeta}
                    className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0 mt-1"
                    title="Copy"
                  >
                    {copied ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <AlertBox type="info">
                This is the address you publish. Share it with anyone who wants to pay you.
                Every payment to this handle lands at a <strong>different</strong> on-chain address —
                an observer cannot link them or calculate your total.
              </AlertBox>

              <Divider label="Register on-chain" />

              <Button
                onClick={handleRegister}
                loading={regState.status === 'pending'}
                disabled={regState.status === 'confirmed'}
                className="w-full"
              >
                <Shield className="w-4 h-4" />
                {regState.status === 'confirmed'
                  ? 'Registered ✓'
                  : 'Register in ERC-6538 Registry'}
              </Button>

              <div className="mt-3">
                <TxStatusBadge state={regState} />
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Done state */}
      {publicBundle && regState.status === 'confirmed' && (
        <Card className="mt-6 border-emerald-800/40 bg-emerald-950/20">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-white mb-1">You&apos;re set up!</h3>
              <p className="text-sm text-gray-400">
                Your meta-address is registered on Sepolia. Share it publicly — anyone can
                send you unlinkable payments by pasting it into the Send page.
              </p>
              <div className="flex flex-wrap gap-3 mt-3">
                <Badge variant="success">ERC-6538 registered</Badge>
                <Badge variant="success">Spending key ready</Badge>
                <Badge variant="success">Viewing key ready</Badge>
              </div>
            </div>
          </div>
        </Card>
      )}
    </PageShell>
  );
}

// ── Address Distinction Panel ─────────────────────────────────
function AddressDistinctionPanel({
  address,
  publicBundle,
}: {
  address: string;
  publicBundle: ReturnType<typeof useStealthKeys>['publicBundle'];
}) {
  return (
    <Card className="bg-gray-950/60">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">
        Three different things — don&apos;t confuse them:
      </h3>
      <div className="grid sm:grid-cols-3 gap-3 text-xs">
        <div className="bg-gray-900 rounded-xl p-3">
          <p className="text-blue-400 font-medium mb-1">Your EOA</p>
          <p className="font-mono text-gray-400 break-all">
            {address.slice(0, 10)}…{address.slice(-6)}
          </p>
          <p className="text-gray-600 mt-1">Your wallet. DO NOT publish for receiving.</p>
        </div>
        <div className="bg-gray-900 rounded-xl p-3">
          <p className="text-indigo-400 font-medium mb-1">Stealth Meta-address</p>
          <p className="font-mono text-gray-400 break-all">
            {publicBundle
              ? `${publicBundle.metaAddress.slice(0, 20)}…`
              : 'Generate keys first'}
          </p>
          <p className="text-gray-600 mt-1">Your handle. Safe to publish publicly.</p>
        </div>
        <div className="bg-gray-900 rounded-xl p-3">
          <p className="text-violet-400 font-medium mb-1">One-time Stealth Addresses</p>
          <p className="font-mono text-gray-400 break-all">0x…fresh per payment</p>
          <p className="text-gray-600 mt-1">Auto-derived per payment. You detect + sweep these.</p>
        </div>
      </div>
    </Card>
  );
}

// ── Key row ───────────────────────────────────────────────────
function KeyRow({
  label,
  value,
  sensitive,
}: {
  label: string;
  value: string;
  sensitive: boolean;
}) {
  const [show, setShow] = useState(!sensitive);
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-xs text-gray-500">{label}</span>
        {sensitive && (
          <button
            onClick={() => setShow((v) => !v)}
            className="text-xs text-gray-600 hover:text-gray-400"
          >
            {show ? 'hide' : 'show'}
          </button>
        )}
      </div>
      <p className="font-mono text-xs text-gray-400 break-all">
        {show ? value : '●'.repeat(32) + '…'}
      </p>
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12">{children}</div>
  );
}
