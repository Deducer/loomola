import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

type Db = ReturnType<typeof drizzle>;

let cached: Db | undefined;

function getDb(): Db {
  if (cached) return cached;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = postgres(connectionString, { prepare: false });
  cached = drizzle(client);
  return cached;
}

// Proxy so existing `db.select()` / `db.insert()` call sites keep working,
// but the underlying postgres client isn't initialised until first query.
// This lets `next build` import modules that reference `db` without needing
// DATABASE_URL in the build environment.
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
