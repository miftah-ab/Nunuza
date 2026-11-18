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


  // Baseline browser security headers for every route. A full
  // Content-Security-Policy is deliberately not set here: Next.js needs
  // per-request nonces for it, which is a separate change.
  async headers() {
    return [
      {
        // Telegram Web embeds the Mini App in a frame, so the reader page is
        // the one route that may be framed, and only by Telegram.
        source: "/telegram/review/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Security-Policy", value: "frame-ancestors https://web.telegram.org https://webk.telegram.org https://webz.telegram.org https://t.me" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/((?!telegram/review).*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },

  // TypeScript strict checks
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
