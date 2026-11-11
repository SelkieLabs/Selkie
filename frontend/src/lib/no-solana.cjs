/**
 * A stand-in for Privy's optional Solana packages.
 *
 * Privy statically imports `@solana/kit` and friends from its Solana funding
 * screens. They are declared optional peer dependencies, and Selkie is a Stellar
 * app with no Solana login method, so those screens can never open. Rather than
 * pull megabytes of a chain we do not support into the tree, next.config points
 * those specifiers here.
 *
 * CommonJS on purpose: named imports against a CJS module resolve at runtime
 * rather than being checked at build time, so this satisfies every import shape
 * Privy uses without listing them one by one.
 */
module.exports = new Proxy(
  {},
  {
    get(_target, property) {
      if (property === "__esModule") return false;
      return undefined;
    },
  },
);
