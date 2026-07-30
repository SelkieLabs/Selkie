import type { NextConfig } from "next";

// The API and the X OAuth dance live on the Selkie server. Rewriting them from
// this app keeps every request same-origin, so the session cookie rides the X
// login redirect and the browser never sees a ledger token. One config covers
// dev (localhost) and production (the deployed API) — the Vite proxy plus the
// vercel.json rewrites this replaces had to say it twice.
const API_ORIGIN = process.env.SELKIE_API_ORIGIN ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // @selkie/core ships as TypeScript source, so the app compiles it itself.
  transpilePackages: ["@selkie/core"],

  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` },
      { source: "/auth/:path*", destination: `${API_ORIGIN}/auth/:path*` },
    ];
  },
};

export default nextConfig;
