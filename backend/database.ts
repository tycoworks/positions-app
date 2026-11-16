// The database compose.yaml names, which tycostream reads too. Both services read and write it
// through Drizzle.
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const pool = new pg.Pool({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
});
// A connection that drops while idle is replaced on the next statement
pool.on("error", (error: Error) => console.warn(`database connection lost: ${error.message}`));

export const db = drizzle(pool);
