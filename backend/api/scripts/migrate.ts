/** Bring a database up to date. Run by the server on boot, and by hand here. */
import { migrate } from "../src/db/migrate";
import { openPool } from "../src/db/pool";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");

const pool = openPool(url);
await migrate(pool, (message) => console.log(message));
await pool.end();
