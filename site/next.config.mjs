import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/ccmux-ide',
  assetPrefix: '/ccmux-ide/',
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  // The repo has other lockfiles at the monorepo level; pin the site as its
  // own workspace root so Next.js does not climb out of /site.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
