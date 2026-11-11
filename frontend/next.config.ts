import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
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
    // The repo root, not this package. Without it Turbopack walks up past the
    // repo, finds a stray lockfile in the home directory and takes that as the
    // root, then watches everything under it — a two minute first page load.
    // It has to be the workspace root rather than frontend/, because npm
    // hoists the dependencies up there and pinning this lower hides them.
    root: resolve(dirname(fileURLToPath(import.meta.url)), ".."),

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
