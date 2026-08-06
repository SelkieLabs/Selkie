import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Keep } from "@selkie/core";

/**
 * A Keep backed by one JSON file.
 *
 * One file rather than one per store, because the interesting failure is a
 * half-applied restart: a user who exists with no wallet key, or a wallet key
 * with no owner. Everything lands in a single rename or none of it does.
 *
 * The rename is what makes that true. Writing over the live file would leave a
 * truncated one behind if the process died mid-write, and a truncated Keep is
 * indistinguishable from a lost one. So it is written beside the real file and
 * moved on top of it, which the filesystem does atomically: a reader either
 * sees the whole old file or the whole new one.
 *
 * This is not the end state. It is a single process writing a small file, and
 * it stops being adequate the moment there are two of them. It is here because
 * the alternative in front of it was losing people's money on every deploy, and
 * a Postgres migration is a change of implementation behind `Keep` rather than
 * a change to anything above it.
 */
export class FileKeep implements Keep {
  readonly #path: string;
  readonly #shelves: Record<string, unknown>;

  constructor(path: string) {
    this.#path = path;
    this.#shelves = load(path);
  }

  read<T>(shelf: string): T | undefined {
    const stored = this.#shelves[shelf];
    // Cloned on the way out so a caller holding the result cannot reach back in
    // and edit what is on the shelf without writing it.
    return stored === undefined ? undefined : (structuredClone(stored) as T);
  }

  write(shelf: string, value: unknown): void {
    this.#shelves[shelf] = value;
    mkdirSync(dirname(this.#path), { recursive: true });

    // Named for this process, so two of them cannot land on each other's
    // half-written file.
    const pending = `${this.#path}.${process.pid}.tmp`;
    // 0600 because this file holds account keys. Until custody moves to Privy,
    // whoever can read it can spend everything in every Selkie wallet, and it
    // must never leave the machine that wrote it.
    writeFileSync(pending, JSON.stringify(this.#shelves, null, 2), { mode: 0o600 });
    renameSync(pending, this.#path);
  }
}

function load(path: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    // Nothing there yet is the ordinary first run. Anything else is a disk we
    // cannot read, and carrying on would look identical to a first run.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    // Refuse to start rather than start empty.
    //
    // Starting empty is the worst thing this could do: the server would come up
    // looking healthy, mint fresh wallets for everyone who signed in, and strand
    // every account in the file it could not read. A server that will not boot
    // gets looked at. One that quietly forgot does not.
    throw new Error(
      `Cannot read ${path}, and it holds every account key. Refusing to start with an empty one. ` +
        `Move it aside deliberately if it is genuinely disposable. (${String(error)})`,
    );
  }
}
