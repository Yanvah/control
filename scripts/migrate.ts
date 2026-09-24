import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
const { initializeDatabase, closeDatabase } = await import("../src/db/client");

try {
  initializeDatabase();
  console.info("Database migrations applied.");
} catch {
  console.error(
    "Database migration failed. Verify configuration, storage permissions, and migration files.",
  );
  process.exitCode = 1;
} finally {
  closeDatabase();
}
