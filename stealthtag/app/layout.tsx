import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { Header } from '@/components/layout/Header';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'StealthTag — Unlinkable Payments on Ethereum',
  description:
    'Publish one payment handle. Receive every payment at a fresh, unlinkable one-time address. ERC-5564 stealth addresses + ERC-4337 sponsored sweeps.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-gray-950 text-gray-100 min-h-screen antialiased`}>
        <Providers>
          <Header />
          <main className="min-h-[calc(100vh-64px)]">{children}</main>
          <footer className="border-t border-gray-800 py-6 text-center text-xs text-gray-500">
            <p>
              Built at{' '}
              <span className="text-indigo-400 font-medium">ROAD TO DEVCON – IIITN EDITION</span>
              {' '}· IIIT Nagpur × Bhaisaaab
            </p>
            <p className="mt-1">
              ERC-5564 stealth addresses · ERC-6538 registry · ERC-4337 sponsored sweeps
            </p>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
