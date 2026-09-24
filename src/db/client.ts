import "server-only";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { assertMigrationHistory } from "../../scripts/database-policy.mjs";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

type ControlDatabase = BetterSQLite3Database<typeof schema>;
type DatabaseConnection = {
  sqlite: Database.Database;
  db: ControlDatabase;
  path: string;
};

const globalDatabase = globalThis as typeof globalThis & {
  controlDatabase?: DatabaseConnection;
};

export function initializeDatabase(): ControlDatabase {
  const path = getEnv().DATABASE_PATH;
  const existing = globalDatabase.controlDatabase;
  if (existing) {
    if (existing.path !== path)
      throw new Error("Database configuration changed during execution.");
    return existing.db;
  }
  let sqlite: Database.Database | undefined;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    sqlite = new Database(path);
    chmodSync(path, 0o600);
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("busy_timeout = 5000");
    const db = drizzle(sqlite, { schema });
    const migrationsFolder = resolve(process.cwd(), "src/db/migrations");
    assertMigrationHistory(sqlite, migrationsFolder);
    migrate(db, { migrationsFolder });
    assertMigrationHistory(sqlite, migrationsFolder);
    globalDatabase.controlDatabase = { sqlite, db, path };
    return db;
  } catch {
    sqlite?.close();
    throw new Error(
      "Database initialization failed. Check storage permissions and migration compatibility; restore a verified backup if needed. No migrations were skipped.",
    );
  }
}

export function getDatabase(): ControlDatabase {
  return initializeDatabase();
}

export function getSqlite(): Database.Database {
  initializeDatabase();
  return globalDatabase.controlDatabase!.sqlite;
}

export function closeDatabase(): void {
  globalDatabase.controlDatabase?.sqlite.close();
  delete globalDatabase.controlDatabase;
}
