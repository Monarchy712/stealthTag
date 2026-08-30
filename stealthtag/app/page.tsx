import Link from 'next/link';
import { ArrowRight, Eye, EyeOff, Link2Off, Shield, Zap } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="relative overflow-hidden">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(99,102,241,.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99,102,241,.5) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Radial glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Hero */}
      <section className="relative max-w-5xl mx-auto px-4 pt-24 pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-indigo-950/60 border border-indigo-800/60 rounded-full px-4 py-1.5 text-xs text-indigo-300 mb-8">
          <Shield className="w-3.5 h-3.5" />
          ERC-5564 Stealth Addresses · ERC-4337 Sponsored Sweeps · Sepolia Testnet
        </div>

        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white mb-6 leading-tight">
          One handle.{' '}
          <br />
          <span className="gradient-text">Unlinkable payments.</span>
        </h1>

        <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Publish a single payment handle. Every payment you receive lands at a fresh,
          one-time address that only you control — unlinkable on Ethereum.
        </p>

        <div className="flex flex-wrap gap-4 justify-center">
          <Link
            href="/setup"
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-6 py-3 rounded-xl transition-all shadow-lg shadow-indigo-900/40"
          >
            Get your StealthTag
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/send"
            className="inline-flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold px-6 py-3 rounded-xl border border-gray-700 transition-all"
          >
            Send an unlinkable payment
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="relative max-w-5xl mx-auto px-4 pb-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-white">How StealthTag works</h2>
          <p className="text-gray-500 mt-2 text-sm">
            Privacy from ERC-5564. Unlinkability from ERC-4337.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <FeatureCard
            icon={<Shield className="w-6 h-6 text-indigo-400" />}
            step="01"
            title="Publish one handle"
            description="Generate a stealth meta-address — a single public handle that encodes your spending and viewing keys. Register it on-chain via ERC-6538."
          />
          <FeatureCard
            icon={<Link2Off className="w-6 h-6 text-violet-400" />}
            step="02"
            title="Receive at distinct addresses"
            description="Each sender derives a unique one-time address from your handle using ECDH (ERC-5564). Every payment lands at a different address — an observer cannot link them."
          />
          <FeatureCard
            icon={<Zap className="w-6 h-6 text-emerald-400" />}
            step="03"
            title="Sweep with sponsored gas"
            description="Scan for your payments using your viewing key. Sweep them out via a smart account UserOperation — Paymaster sponsors the gas so no stealth address is ever funded from a known wallet."
          />
        </div>
      </section>

      {/* Privacy truth */}
      <section className="relative max-w-5xl mx-auto px-4 pb-20">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Eye className="w-5 h-5 text-red-400" />
                <h3 className="text-lg font-bold text-white">Public address</h3>
              </div>
              <ul className="space-y-2 text-sm text-gray-400">
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">✗</span>
                  Anyone can total your received balance
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">✗</span>
                  Every payment sender is visible on-chain
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">✗</span>
                  Payment frequency and amounts are public
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">✗</span>
                  Your full payment graph is reconstructable
                </li>
              </ul>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-4">
                <EyeOff className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-bold text-white">StealthTag handle</h3>
              </div>
              <ul className="space-y-2 text-sm text-gray-400">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  Payments land at distinct, unlinkable addresses
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  Only you can identify payments that belong to you
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  Balance is non-disclosable to observers
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-yellow-400 mt-0.5">~</span>
                  Amounts still visible on-chain (transparent chain)
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* AA explanation */}
      <section className="relative max-w-5xl mx-auto px-4 pb-24">
        <div className="bg-gradient-to-br from-indigo-950/60 to-gray-900 border border-indigo-800/40 rounded-2xl p-8">
          <h3 className="text-xl font-bold text-white mb-3 flex items-center gap-2">
            <Zap className="w-5 h-5 text-indigo-400" />
            Why Account Abstraction?
          </h3>
          <p className="text-gray-300 text-sm leading-relaxed mb-4">
            Sweeping funds from a stealth address requires gas <em>at that address</em>. If you
            fund it from your main wallet, the two addresses are linked on-chain — the privacy
            is gone. A <strong className="text-indigo-400">Paymaster sponsors the sweep gas</strong>,
            so funds leave the stealth address without ever needing ETH from a known wallet.
          </p>
          <p className="text-xs text-gray-500">
            ERC-4337 is load-bearing here, not decorative. Privacy comes from ERC-5564 stealth
            addresses; AA makes the sweep unlinkable.
          </p>
        </div>
      </section>
    </div>
  );
}

function FeatureCard({
  icon,
  step,
  title,
  description,
}: {
  icon: React.ReactNode;
  step: string;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 card-hover relative overflow-hidden">
      <div className="absolute top-4 right-4 text-4xl font-black text-gray-800 select-none">
        {step}
      </div>
      <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="font-bold text-white mb-2">{title}</h3>
      <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
    </div>
  );
}
