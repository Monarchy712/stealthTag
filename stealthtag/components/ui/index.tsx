'use client';

import { type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import type { TxState } from '@/types';

// ── Generic Card ─────────────────────────────────────────────
interface CardProps {
  children: ReactNode;
  className?: string;
}
export function Card({ children, className = '' }: CardProps) {
  return (
    <div
      className={`bg-gray-900 border border-gray-800 rounded-2xl p-6 card-hover ${className}`}
    >
      {children}
    </div>
  );
}

// ── Badge ────────────────────────────────────────────────────
export type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'demo';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
}
export function Badge({ children, variant = 'default' }: BadgeProps) {
  const styles = {
    default: 'bg-gray-800 text-gray-300',
    success: 'bg-emerald-900/40 text-emerald-400 border border-emerald-800',
    warning: 'bg-yellow-900/40 text-yellow-400 border border-yellow-800',
    error: 'bg-red-900/40 text-red-400 border border-red-800',
    info: 'bg-indigo-900/40 text-indigo-400 border border-indigo-800',
    demo: 'bg-orange-900/40 text-orange-400 border border-orange-800',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${styles[variant]}`}>
      {children}
    </span>
  );
}

// ── Button ───────────────────────────────────────────────────
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: ReactNode;
}
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  children,
  disabled,
  className = '',
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed';
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-5 py-2.5 text-sm',
    lg: 'px-6 py-3 text-base',
  };
  const variants = {
    primary:
      'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white shadow-lg shadow-indigo-900/30',
    secondary:
      'bg-gray-800 hover:bg-gray-700 active:bg-gray-900 text-gray-200 border border-gray-700',
    danger:
      'bg-red-700 hover:bg-red-600 active:bg-red-800 text-white',
    ghost: 'hover:bg-gray-800 text-gray-400 hover:text-gray-200',
  };
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

// ── TxStatusBadge ────────────────────────────────────────────
interface TxStatusBadgeProps {
  state: TxState;
  explorerBase?: string;
}
export function TxStatusBadge({
  state,
  explorerBase = 'https://sepolia.etherscan.io',
}: TxStatusBadgeProps) {
  if (state.status === 'idle') return null;

  const icons = {
    pending: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
    submitted: <Clock className="w-3.5 h-3.5" />,
    confirmed: <CheckCircle2 className="w-3.5 h-3.5" />,
    failed: <XCircle className="w-3.5 h-3.5" />,
    simulated: <AlertTriangle className="w-3.5 h-3.5" />,
  };

  const label = {
    pending: 'Preparing…',
    submitted: 'Submitted to bundler…',
    confirmed: state.isSimulated ? '[DEMO] Sweep simulated' : 'Confirmed ✓',
    failed: `Failed: ${state.error ?? 'unknown'}`,
    simulated: '[DEMO] Simulated',
  };

  const variant: BadgeVariant =
    state.status === 'confirmed'
      ? state.isSimulated
        ? 'demo'
        : 'success'
      : state.status === 'failed'
      ? 'error'
      : state.status === 'pending' || state.status === 'submitted'
      ? 'info'
      : 'demo';

  return (
    <div className="flex flex-col gap-1">
      <Badge variant={variant}>
        {icons[state.status]}
        {label[state.status]}
      </Badge>
      {state.hash && state.status === 'confirmed' && !state.isSimulated && (
        <a
          href={`${explorerBase}/tx/${state.hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-indigo-400 hover:text-indigo-300 underline ml-1"
        >
          View on Etherscan ↗
        </a>
      )}
    </div>
  );
}

// ── AddressPill ──────────────────────────────────────────────
interface AddressPillProps {
  address: string;
  label?: string;
  explorerBase?: string;
  copyable?: boolean;
}
export function AddressPill({
  address,
  label,
  explorerBase = 'https://sepolia.etherscan.io',
  copyable = true,
}: AddressPillProps) {
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-gray-500">{label}:</span>}
      <a
        href={`${explorerBase}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-950/40 border border-indigo-900/50 px-2 py-0.5 rounded-lg"
        title={address}
      >
        {short}
      </a>
    </div>
  );
}

// ── SectionHeading ───────────────────────────────────────────
interface SectionHeadingProps {
  title: string;
  subtitle?: string;
  badge?: string;
}
export function SectionHeading({ title, subtitle, badge }: SectionHeadingProps) {
  return (
    <div className="mb-6">
      {badge && <Badge variant="info">{badge}</Badge>}
      <h2 className="text-2xl font-bold text-white mt-2">{title}</h2>
      {subtitle && <p className="text-gray-400 mt-1 text-sm">{subtitle}</p>}
    </div>
  );
}

// ── AlertBox ─────────────────────────────────────────────────
interface AlertBoxProps {
  type: 'info' | 'warning' | 'error' | 'success' | 'demo';
  title?: string;
  children: ReactNode;
}
export function AlertBox({ type, title, children }: AlertBoxProps) {
  const styles = {
    info: 'bg-indigo-950/40 border-indigo-800 text-indigo-200',
    warning: 'bg-yellow-950/40 border-yellow-800 text-yellow-200',
    error: 'bg-red-950/40 border-red-800 text-red-200',
    success: 'bg-emerald-950/40 border-emerald-800 text-emerald-200',
    demo: 'bg-orange-950/40 border-orange-800 text-orange-200',
  };
  return (
    <div className={`rounded-xl border p-4 ${styles[type]}`}>
      {title && <p className="font-semibold text-sm mb-1">{title}</p>}
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

// ── StepNumber ───────────────────────────────────────────────
export function StepNumber({ n }: { n: number }) {
  return (
    <div className="w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
      {n}
    </div>
  );
}

// ── Spinner ──────────────────────────────────────────────────
export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

// ── Divider ──────────────────────────────────────────────────
export function Divider({ label }: { label?: string }) {
  if (!label)
    return <div className="border-t border-gray-800 my-6" />;
  return (
    <div className="relative my-6">
      <div className="border-t border-gray-800" />
      <span className="absolute left-1/2 -translate-x-1/2 -top-2.5 bg-gray-950 px-3 text-xs text-gray-500">
        {label}
      </span>
    </div>
  );
}
