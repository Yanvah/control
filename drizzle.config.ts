import { defineConfig } from "drizzle-kit";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseEnv } from "./src/lib/env/schema";

// @next/env is bundled CommonJS; resolve it consistently in Drizzle's config loader.
const nextEnv: typeof import("@next/env") = createRequire(
  resolve(process.cwd(), "package.json"),
)("@next/env");
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
const databasePath = process.argv.includes("studio")
  ? parseEnv(process.env).DATABASE_PATH
  : (process.env.DATABASE_PATH ?? "./.data/control.db");

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: databasePath },
  strict: true,
  verbose: true,
});
