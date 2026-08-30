import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Required for wagmi/viem SSR
  transpilePackages: ['wagmi', 'viem', '@rainbow-me/rainbowkit', '@scopelift/stealth-address-sdk'],
  serverExternalPackages: ['@coinbase/cdp-sdk', '@base-org/account', 'graphql'],
  turbopack: {},
};

export default nextConfig;
