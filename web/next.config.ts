// web/next.config.ts
import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  transpilePackages: ['@as/shared'], // workspace package shipped as TypeScript source
  turbopack: { root: path.join(here, '..') }, // monorepo root, so Turbopack resolves workspace packages
};
export default nextConfig;
