import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@parakeet/shared'],
  poweredByHeader: false,
  // Self-contained server for the Docker image (see /Dockerfile); traced from the monorepo root so
  // workspace packages are included.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
};

export default nextConfig;
