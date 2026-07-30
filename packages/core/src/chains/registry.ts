import type { ChainAdapter } from "./adapter";
import type { ChainId } from "./types";

/**
 * Holds every chain the product supports at runtime. Surfaces ask the registry
 * for a chain and call the adapter's methods, so the rest of the app never
 * imports a chain package directly.
 */
export class ChainRegistry {
  #adapters = new Map<ChainId, ChainAdapter>();
  #defaultChain: ChainId | undefined;

  /** Register an adapter. The first one registered becomes the default. */
  register(adapter: ChainAdapter, opts: { default?: boolean } = {}): this {
    this.#adapters.set(adapter.id, adapter);
    if (opts.default || this.#defaultChain === undefined) this.#defaultChain = adapter.id;
    return this;
  }

  get(id: ChainId): ChainAdapter {
    const adapter = this.#adapters.get(id);
    if (!adapter) throw new Error(`No chain adapter registered for "${id}"`);
    return adapter;
  }

  get default(): ChainAdapter {
    if (this.#defaultChain === undefined) throw new Error("No chains registered");
    return this.get(this.#defaultChain);
  }

  list(): ChainAdapter[] {
    return [...this.#adapters.values()];
  }
}
