import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

export function createPgPool(connectionString: string): Pool {
  const isSupabaseConnection =
    connectionString.includes("supabase.co") ||
    connectionString.includes("pooler.supabase.com");

  return new Pool({
    connectionString,
    max: 20,
    ssl: isSupabaseConnection
      ? {
          rejectUnauthorized: false
        }
      : undefined
  });
}

export async function ensureDatabaseSchema(pool: Pool): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const sqlPath = join(__dirname, "../../sql/init.sql");
  const sql = readFileSync(sqlPath, "utf8");
  await pool.query(sql);
}
