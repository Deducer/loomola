import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertCoreEnv } from "../src/lib/env-check";

function loadLocalEnvIfNeeded() {
  if (process.env.DATABASE_URL) return;

  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const contents = readFileSync(file, "utf8");
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;

      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;

      const value = rawValue.trim().replace(/^(['"])(.*)\1$/, "$2");
      process.env[key] = value;
    }
    if (process.env.DATABASE_URL) return;
  }
}

async function main() {
  loadLocalEnvIfNeeded();

  // Fail fast in containers: one readable list beats lazy crashes. Dev stays
  // permissive so `npm run db:migrate` works during incremental setup.
  if (process.env.NODE_ENV === "production") {
    assertCoreEnv();
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const migrationsFolder = "./drizzle";
  const journalPath = join(migrationsFolder, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    console.log(`no migrations to apply (missing ${journalPath})`);
    return;
  }

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder });
  await client.end();
  console.log("migrations applied");
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
