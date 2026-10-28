import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for @opennextjs/cloudflare
  // Docs: https://opennext.js.org/cloudflare
  output: undefined, // cloudflare adapter handles output

  // Allowed image domains — update when adding external image sources
  images: {
    remotePatterns: [],
    // Disable default image optimization; use Cloudflare Images if needed in future
    unoptimized: true,
  },

  // Strict mode for catching React bugs early
  reactStrictMode: true,


  // TypeScript strict checks
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
