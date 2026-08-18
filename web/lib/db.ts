import { Pool } from "pg";

// Reused across requests in dev/serverless - avoids opening a new Neon
// connection per page render. The scraper (Python, repo root) owns the
// schema/migrations; this is a read client only.
declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

export const pool =
  global.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: true,
  });

if (process.env.NODE_ENV !== "production") {
  global.pgPool = pool;
}
