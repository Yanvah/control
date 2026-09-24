import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { assertMigrationHistory } from "../../scripts/database-policy.mjs";

const scripts = {
  setup: resolve("scripts/production-setup.mjs"),
  maintenance: resolve("scripts/database-maintenance.mjs"),
};
const migrationsFolder = resolve("src/db/migrations");
const directories: string[] = [];

function directory(): string {
  mkdirSync(".test-data", { recursive: true });
  const path = mkdtempSync(resolve(".test-data/production-operations-"));
  directories.push(path);
  return path;
}

function run(
  script: "setup" | "maintenance",
  cwd: string,
  args: string[],
  env: Partial<NodeJS.ProcessEnv> = {},
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [scripts[script], ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_PATH: join(cwd, "control.db"),
      ...env,
    },
  });
}

function seedDatabase(path: string): void {
  const sqlite = new Database(path);
  migrate(drizzle(sqlite), { migrationsFolder });
  sqlite
    .prepare(
      "INSERT INTO auth_throttle (key,count,window_started_at) VALUES (?,?,?)",
    )
    .run("persist-after-restore", 2, 12345);
  sqlite.close();
}

afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("production configuration generation", () => {
  it.each([
    [],
    ["--url", "https://control.example.com"],
    ["--production", "--url", "http://control.example.com"],
    ["--production", "--url", "https://control.example.com/subpath"],
    ["--production", "--url", "https://user:password@control.example.com"],
    ["--production", "--url", "https://control.example.com?token=secret"],
  ])("requires explicit opt-in and a bare HTTPS origin: %j", (...args) => {
    const cwd = directory();
    expect(run("setup", cwd, args).status).toBe(1);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("creates private independent secrets once without printing them or seeding a database", () => {
    const cwd = directory();
    const args = ["--production", "--url", "https://control.example.com"];
    const output = run("setup", cwd, args);
    expect(output.status).toBe(0);
    const path = join(cwd, ".env.production");
    const contents = readFileSync(path, "utf8");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(contents).toContain("CONTROL_URL=https://control.example.com");
    expect(contents).toContain("DATABASE_PATH=/data/control.db");
    const secrets = contents
      .split("\n")
      .filter((line) =>
        /^CONTROL_(AUTH_SECRET|ENCRYPTION_KEY|SETUP_TOKEN)=/.test(line),
      )
      .map((line) => line.slice(line.indexOf("=") + 1));
    expect(new Set(secrets).size).toBe(3);
    for (const secret of secrets) {
      expect(Buffer.from(secret, "base64")).toHaveLength(32);
      expect(String(output.stdout) + String(output.stderr)).not.toContain(
        secret,
      );
    }
    expect(readdirSync(cwd)).toEqual([".env.production"]);
    expect(run("setup", cwd, args).status).toBe(1);
    expect(readFileSync(path, "utf8")).toBe(contents);
  });
});

describe("offline backup and restore", () => {
  it("creates a standalone verified snapshot and restores it only to an empty target", () => {
    const cwd = directory();
    const database = join(cwd, "control.db");
    seedDatabase(database);
    const backup = join(cwd, "backups/snapshot.db");
    const args = ["backup", "--offline", "--output", backup];
    expect(run("maintenance", cwd, args).status).toBe(0);
    expect(statSync(backup).mode & 0o777).toBe(0o600);
    expect(run("maintenance", cwd, ["verify", "--input", backup]).status).toBe(
      0,
    );
    const snapshot = readFileSync(backup);
    const portable = new Database(backup, { readonly: true });
    expect(portable.pragma("journal_mode", { simple: true })).toBe("delete");
    portable.close();
    expect(run("maintenance", cwd, args).status).toBe(1);
    expect(readFileSync(backup)).toEqual(snapshot);
    expect(
      run("maintenance", cwd, ["restore", "--offline", "--input", backup])
        .status,
    ).toBe(1);
    const restoredPath = join(cwd, "restored/control.db");
    expect(
      run("maintenance", cwd, ["restore", "--offline", "--input", backup], {
        DATABASE_PATH: restoredPath,
      }).status,
    ).toBe(0);
    const restored = new Database(restoredPath, { readonly: true });
    expect(
      restored
        .prepare("SELECT count FROM auth_throttle WHERE key = ?")
        .get("persist-after-restore"),
    ).toEqual({ count: 2 });
    expect(assertMigrationHistory(restored, migrationsFolder)).toEqual({
      applied: 5,
      available: 5,
    });
    restored.close();
    expect(statSync(restoredPath).mode & 0o777).toBe(0o600);
  });

  it("includes committed WAL content in a standalone backup", () => {
    const cwd = directory();
    const database = join(cwd, "control.db");
    seedDatabase(database);
    const writer = new Database(database);
    writer.pragma("journal_mode = WAL");
    writer.prepare("UPDATE auth_throttle SET count = 9").run();
    const backup = join(cwd, "snapshot.db");
    try {
      expect(existsSync(`${database}-wal`)).toBe(true);
      expect(
        run("maintenance", cwd, ["backup", "--offline", "--output", backup])
          .status,
      ).toBe(0);
      const snapshot = new Database(backup, { readonly: true });
      expect(snapshot.prepare("SELECT count FROM auth_throttle").get()).toEqual(
        { count: 9 },
      );
      snapshot.close();
    } finally {
      writer.close();
    }
  });

  it("requires stopped-instance acknowledgement and refuses leftover sidecars or unsafe production paths", () => {
    const cwd = directory();
    seedDatabase(join(cwd, "control.db"));
    const backup = join(cwd, "snapshot.db");
    expect(run("maintenance", cwd, ["backup", "--output", backup]).status).toBe(
      1,
    );
    expect(existsSync(backup)).toBe(false);
    expect(
      run("maintenance", cwd, ["backup", "--offline", "--output", backup], {
        NODE_ENV: "production",
      }).status,
    ).toBe(1);
    expect(
      run("maintenance", cwd, ["backup", "--offline", "--output", backup])
        .status,
    ).toBe(0);
    const restored = join(cwd, "restored.db");
    writeFileSync(`${restored}-wal`, "leftover");
    expect(
      run("maintenance", cwd, ["restore", "--offline", "--input", backup], {
        DATABASE_PATH: restored,
      }).status,
    ).toBe(1);
    expect(existsSync(restored)).toBe(false);
    expect(readFileSync(`${restored}-wal`, "utf8")).toBe("leftover");
  });

  it("rejects corrupt/unrelated databases and mismatched migration histories without exposing contents", () => {
    const cwd = directory();
    const bad = join(cwd, "damaged.db");
    const privateValue = randomBytes(32).toString("base64");
    writeFileSync(bad, privateValue);
    const output = run("maintenance", cwd, ["verify", "--input", bad]);
    expect(output.status).toBe(1);
    expect(String(output.stdout) + String(output.stderr)).not.toContain(
      privateValue,
    );
    expect(
      run("maintenance", cwd, ["restore", "--offline", "--input", bad]).status,
    ).toBe(1);
    expect(existsSync(join(cwd, "control.db"))).toBe(false);
    rmSync(bad);
    seedDatabase(bad);
    const database = new Database(bad);
    database
      .prepare(
        "UPDATE __drizzle_migrations SET hash = ? WHERE created_at = (SELECT MIN(created_at) FROM __drizzle_migrations)",
      )
      .run(privateValue);
    database.close();
    expect(run("maintenance", cwd, ["verify", "--input", bad]).status).toBe(1);
    expect(
      run("maintenance", cwd, ["restore", "--offline", "--input", bad]).status,
    ).toBe(1);
    expect(existsSync(join(cwd, "control.db"))).toBe(false);
  });
});
