import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

// Anchored to this file rather than the working directory, for the same reason
// the contract id is: the API starts from the repo root in development and from
// its own folder under npm workspaces, and migrations that only apply when you
// are standing in the right place are migrations that do not apply.
const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations");

/**
 * Bringing a database up to date, safely enough to run on boot.
 *
 * Three properties, each of which exists because of a specific way this goes
 * wrong in production:
 *
 *  - An advisory lock, so two servers starting at the same moment do not both
 *    try to create the same table. The second one waits, then finds there is
 *    nothing left to do.
 *  - One transaction per migration, so a statement that fails halfway leaves
 *    the database on the version it was already on rather than in a shape no
 *    version describes.
 *  - A checksum of every migration that has already run. Editing an applied
 *    migration is silent: it works on your laptop, where you re-created the
 *    database, and does nothing on the server, where it already ran. Then the
 *    two disagree about what the schema is. Here it refuses to start instead.
 */
export async function migrate(pool: Pool, log: (message: string) => void = () => {}): Promise<void> {
  const client = await pool.connect();
  try {
    // Any constant will do, so long as it is only ever used for this.
    await client.query("select pg_advisory_lock(4207791)");

    await client.query(`
      create table if not exists schema_migrations (
        version    text primary key,
        checksum   text not null,
        applied_at timestamptz not null default now()
      )
    `);

    const applied = new Map<string, string>(
      (await client.query<{ version: string; checksum: string }>(
        "select version, checksum from schema_migrations",
      )).rows.map((row) => [row.version, row.checksum]),
    );

    let ran = 0;
    for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
      const sql = readFileSync(join(MIGRATIONS, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex").slice(0, 32);
      const before = applied.get(file);

      if (before === checksum) continue;
      if (before) {
        throw new Error(
          `Migration ${file} has changed since it was applied. The database and this code no longer agree ` +
            `about the schema, and running it again would not fix that. Write a new migration instead.`,
        );
      }

      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (version, checksum) values ($1, $2)", [
          file,
          checksum,
        ]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed, and nothing from it was applied. ${String(error)}`);
      }

      log(`applied ${file}`);
      ran++;
    }

    log(ran === 0 ? "database already up to date" : `applied ${ran} migration${ran === 1 ? "" : "s"}`);
  } finally {
    // Released even if a migration threw, or the next boot would block forever
    // waiting on a lock held by a process that has gone.
    await client.query("select pg_advisory_unlock(4207791)").catch(() => {});
    client.release();
  }
}
