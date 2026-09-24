import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const script = resolve("scripts/dev-setup.ts");

function runSetup(
  environment: "development" | "production",
  args: string[],
): { directory: string; output: ReturnType<typeof spawnSync> } {
  mkdirSync(".test-data", { recursive: true });
  const directory = mkdtempSync(resolve(".test-data/setup-"));
  directories.push(directory);
  return {
    directory,
    output: spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
      cwd: directory,
      env: { ...process.env, NODE_ENV: environment },
      encoding: "utf8",
    }),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("explicit local setup tooling", () => {
  it("refuses production even with the local flag", () => {
    const { directory, output } = runSetup("production", ["--local"]);
    expect(output.status).toBe(1);
    expect(existsSync(resolve(directory, ".env.local"))).toBe(false);
  });

  it("requires an explicit local opt-in", () => {
    const { directory, output } = runSetup("development", []);
    expect(output.status).toBe(1);
    expect(existsSync(resolve(directory, ".env.local"))).toBe(false);
  });

  it("creates private local configuration once without printing secrets or creating an owner", () => {
    const { directory, output } = runSetup("development", ["--local"]);
    expect(output.status).toBe(0);
    const envPath = resolve(directory, ".env.local");
    const contents = readFileSync(envPath, "utf8");
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    const secrets = contents
      .split("\n")
      .filter((line) =>
        /CONTROL_(AUTH_SECRET|ENCRYPTION_KEY|SETUP_TOKEN)=/.test(line),
      )
      .map((line) => line.slice(line.indexOf("=") + 1));
    expect(new Set(secrets).size).toBe(3);
    for (const value of secrets)
      expect(String(output.stdout) + String(output.stderr)).not.toContain(
        value,
      );
    expect(existsSync(resolve(directory, ".data/control.db"))).toBe(false);
    const secondRun = spawnSync(
      process.execPath,
      ["--import", "tsx", script, "--local"],
      {
        cwd: directory,
        env: { ...process.env, NODE_ENV: "development" },
        encoding: "utf8",
      },
    );
    expect(secondRun.status).toBe(1);
    expect(readFileSync(envPath, "utf8")).toBe(contents);
  });
});
