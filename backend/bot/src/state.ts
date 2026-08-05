import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * What the worker has already dealt with.
 *
 * Kept on disk because the alternative is a restart replaying every mention it
 * has ever seen, which on a payments bot means paying everybody twice. Small
 * enough that a single file is the right answer, and swapping it for a row in
 * Postgres later is one class.
 */
export interface WorkerState {
  /** Newest mention id already handled. */
  sinceId?: string;
}

export interface StateStore {
  read(): WorkerState;
  write(state: WorkerState): void;
}

export class FileStateStore implements StateStore {
  constructor(private readonly path: string) {}

  read(): WorkerState {
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as WorkerState;
    } catch {
      // No file yet, or one we cannot read. Either way this is a first run, and
      // the worker takes the current newest mention as its baseline rather than
      // acting on a backlog.
      return {};
    }
  }

  write(state: WorkerState): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(state, null, 2));
  }
}

/** For tests, and for a run that should deliberately leave no trace. */
export class MemoryStateStore implements StateStore {
  #state: WorkerState;

  constructor(initial: WorkerState = {}) {
    this.#state = initial;
  }

  read(): WorkerState {
    return this.#state;
  }

  write(state: WorkerState): void {
    this.#state = state;
  }
}
