import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertMigrationHistory } from "../../scripts/database-policy.mjs";

const configuration = vi.hoisted(() => ({ path: "" }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ DATABASE_PATH: configuration.path }),
}));
import { closeDatabase, initializeDatabase } from "./client";

const migrationsFolder = resolve("src/db/migrations");
const databases: Database.Database[] = [];
const directories: string[] = [];

function database(): Database.Database {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  return sqlite;
}

function migrationCopy(): string {
  mkdirSync(".test-data", { recursive: true });
  const folder = mkdtempSync(resolve(".test-data/migration-policy-"));
  directories.push(folder);
  cpSync(migrationsFolder, folder, { recursive: true });
  return folder;
}

afterEach(() => {
  closeDatabase();
  for (const sqlite of databases.splice(0)) sqlite.close();
  for (const folder of directories.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

describe("versioned migration history", () => {
  it("accepts fresh storage and repeated committed migrations without changes", () => {
    const sqlite = database();
    expect(assertMigrationHistory(sqlite, migrationsFolder)).toEqual({
      applied: 0,
      available: 5,
    });
    migrate(drizzle(sqlite), { migrationsFolder });
    expect(assertMigrationHistory(sqlite, migrationsFolder)).toEqual({
      applied: 5,
      available: 5,
    });
    migrate(drizzle(sqlite), { migrationsFolder });
    expect(
      sqlite
        .prepare("SELECT count(*) AS count FROM __drizzle_migrations")
        .get(),
    ).toEqual({ count: 5 });
  });

  it("allows an exact older prefix to upgrade and rejects running an older image afterward", () => {
    const sqlite = database();
    const olderFolder = migrationCopy();
    const journalPath = resolve(olderFolder, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: unknown[];
    };
    journal.entries.pop();
    writeFileSync(journalPath, JSON.stringify(journal));
    migrate(drizzle(sqlite), { migrationsFolder: olderFolder });
    expect(assertMigrationHistory(sqlite, migrationsFolder)).toEqual({
      applied: 4,
      available: 5,
    });
    migrate(drizzle(sqlite), { migrationsFolder });
    expect(() => assertMigrationHistory(sqlite, olderFolder)).toThrow(
      "incompatible or damaged",
    );
    expect(assertMigrationHistory(sqlite, migrationsFolder)).toEqual({
      applied: 5,
      available: 5,
    });
  });

  it.each(["changed hash", "missing entry", "unknown newer migration"])(
    "rejects %s",
    (condition) => {
      const sqlite = database();
      migrate(drizzle(sqlite), { migrationsFolder });
      if (condition === "changed hash")
        sqlite
          .prepare("UPDATE __drizzle_migrations SET hash = 'changed'")
          .run();
      if (condition === "missing entry")
        sqlite
          .prepare(
            "DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MIN(created_at) FROM __drizzle_migrations)",
          )
          .run();
      if (condition === "unknown newer migration")
        sqlite
          .prepare(
            "INSERT INTO __drizzle_migrations(hash,created_at) VALUES('future',9999999999999)",
          )
          .run();
      expect(() => assertMigrationHistory(sqlite, migrationsFolder)).toThrow(
        "incompatible or damaged",
      );
    },
  );

  it("rejects edited migration files and unmanaged database tables", () => {
    const sqlite = database();
    migrate(drizzle(sqlite), { migrationsFolder });
    const folder = migrationCopy();
    writeFileSync(
      resolve(folder, "0000_auth_foundation.sql"),
      "-- edited after release",
    );
    expect(() => assertMigrationHistory(sqlite, folder)).toThrow(
      "incompatible or damaged",
    );
    const unmanaged = database();
    unmanaged.exec("CREATE TABLE unmanaged (id INTEGER)");
    expect(() => assertMigrationHistory(unmanaged, migrationsFolder)).toThrow(
      "incompatible or damaged",
    );
  });

  it("rolls back a failing migration without partial schema changes or false history", () => {
    const sqlite = database();
    migrate(drizzle(sqlite), { migrationsFolder });
    const folder = migrationCopy();
    const journalPath = resolve(folder, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: {
        idx: number;
        version: string;
        when: number;
        tag: string;
        breakpoints: boolean;
      }[];
    };
    journal.entries.push({
      idx: 5,
      version: "6",
      when: 9999999999999,
      tag: "0005_failure_fixture",
      breakpoints: true,
    });
    writeFileSync(journalPath, JSON.stringify(journal));
    writeFileSync(
      resolve(folder, "0005_failure_fixture.sql"),
      "CREATE TABLE partial_change (id INTEGER);\n--> statement-breakpoint\nSELECT * FROM missing_table;",
    );
    expect(assertMigrationHistory(sqlite, folder)).toEqual({
      applied: 5,
      available: 6,
    });
    expect(() =>
      migrate(drizzle(sqlite), { migrationsFolder: folder }),
    ).toThrow();
    expect(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE name='partial_change'")
        .get(),
    ).toBeUndefined();
    expect(assertMigrationHistory(sqlite, folder)).toEqual({
      applied: 5,
      available: 6,
    });
  });

  it("fails application startup safely on incompatible history without accepting the connection", () => {
    const folder = migrationCopy();
    configuration.path = resolve(folder, "private-instance.db");
    const sqlite = new Database(configuration.path);
    migrate(drizzle(sqlite), { migrationsFolder });
    const original = sqlite
      .prepare(
        "SELECT hash FROM __drizzle_migrations ORDER BY created_at LIMIT 1",
      )
      .get() as { hash: string };
    sqlite
      .prepare(
        "UPDATE __drizzle_migrations SET hash='damaged' WHERE created_at=(SELECT MIN(created_at) FROM __drizzle_migrations)",
      )
      .run();
    expect(() => initializeDatabase()).toThrow(
      "Database initialization failed",
    );
    try {
      initializeDatabase();
    } catch (error) {
      expect(String(error)).not.toContain(configuration.path);
      expect(String(error)).not.toContain("damaged");
    }
    sqlite
      .prepare(
        "UPDATE __drizzle_migrations SET hash=? WHERE created_at=(SELECT MIN(created_at) FROM __drizzle_migrations)",
      )
      .run(original.hash);
    sqlite.close();
    expect(() => initializeDatabase()).not.toThrow();
  });

  it("sanitizes storage initialization failures as well as SQL failures", () => {
    const folder = migrationCopy();
    const blocker = resolve(folder, "private-file");
    writeFileSync(blocker, "not a directory");
    configuration.path = resolve(blocker, "control.db");
    expect(() => initializeDatabase()).toThrow(
      "Database initialization failed",
    );
    try {
      initializeDatabase();
    } catch (error) {
      expect(String(error)).not.toContain(blocker);
    }
  });
});
