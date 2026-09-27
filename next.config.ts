import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this project. Without it Next.js walks upward,
  // finds a stray lockfile in the parent folder and infers the wrong root.
  outputFileTracingRoot: __dirname,
  // The Postgres driver is loaded from node_modules at runtime rather than
  // bundled: it probes for an optional native binding that bundling breaks.
  serverExternalPackages: ['pg'],
};

export default nextConfig;
