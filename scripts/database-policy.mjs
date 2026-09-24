import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const failure = () =>
  new Error(
    "Database migration history is incompatible or damaged. Use the matching image and restore a verified backup; never edit applied migrations.",
  );

/** Validate an exact prefix: Drizzle itself only compares the latest timestamp. */
export function assertMigrationHistory(sqlite, migrationsFolder) {
  let expected;
  try {
    const journal = JSON.parse(
      readFileSync(resolve(migrationsFolder, "meta/_journal.json"), "utf8"),
    );
    if (
      journal.dialect !== "sqlite" ||
      !Array.isArray(journal.entries) ||
      journal.entries.length === 0
    )
      throw failure();
    expected = journal.entries.map((entry, index) => {
      if (
        entry.idx !== index ||
        !Number.isSafeInteger(entry.when) ||
        entry.when <= 0 ||
        !/^\d{4}_[a-z0-9_]+$/.test(entry.tag)
      )
        throw failure();
      if (index > 0 && journal.entries[index - 1].when >= entry.when)
        throw failure();
      const contents = readFileSync(
        resolve(migrationsFolder, `${entry.tag}.sql`),
      );
      return {
        hash: createHash("sha256").update(contents).digest("hex"),
        created_at: entry.when,
      };
    });
  } catch {
    throw failure();
  }
  const hasHistory = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();
  const applied = hasHistory
    ? sqlite
        .prepare(
          "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at",
        )
        .all()
    : [];
  if (applied.length > expected.length) throw failure();
  for (const [index, migration] of applied.entries()) {
    if (
      migration.hash !== expected[index].hash ||
      migration.created_at !== expected[index].created_at
    )
      throw failure();
  }
  if (applied.length === 0) {
    const existingTable = sqlite
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' LIMIT 1",
      )
      .get();
    if (existingTable) throw failure();
  }
  return { applied: applied.length, available: expected.length };
}

export function verifyDatabase(sqlite, migrationsFolder) {
  const integrity = sqlite.pragma("integrity_check");
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok")
    throw new Error("Database integrity verification failed.");
  if (sqlite.pragma("foreign_key_check").length !== 0)
    throw new Error("Database relationship verification failed.");
  const history = assertMigrationHistory(sqlite, migrationsFolder);
  if (history.applied === 0)
    throw new Error("Backup must contain a migrated Control database.");
  return history;
}
