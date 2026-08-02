import type { NextConfig } from "next";

// The API lives on the Selkie server. Rewriting it from this app keeps every
// request same-origin, so there is no CORS layer to get wrong and only one place
// that knows the API's address. One config covers dev (localhost) and production
// (the deployed API).
const API_ORIGIN = process.env.SELKIE_API_ORIGIN ?? "http://localhost:4000";

// Privy statically imports its optional Solana peers. Selkie has no Solana
// login method, so those screens can never open; pointing the specifiers at a
// stub keeps a chain we do not support out of the build. See no-solana.cjs.
const SOLANA_STUB = "./src/lib/no-solana.cjs";

const nextConfig: NextConfig = {
  // @selkie/core ships as TypeScript source, so the app compiles it itself.
  transpilePackages: ["@selkie/core"],

  turbopack: {
    resolveAlias: {
      "@solana/kit": SOLANA_STUB,
      "@solana-program/system": SOLANA_STUB,
      "@solana-program/token": SOLANA_STUB,
      "@solana-program/memo": SOLANA_STUB,
    },
  },

  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/:path*` }];
  },
};

export default nextConfig;
