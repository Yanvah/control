import type Database from "better-sqlite3";

export type MigrationStatus = { applied: number; available: number };
export function assertMigrationHistory(
  sqlite: Database.Database,
  migrationsFolder: string,
): MigrationStatus;
export function verifyDatabase(
  sqlite: Database.Database,
  migrationsFolder: string,
): MigrationStatus;
