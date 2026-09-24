import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test as base } from "@playwright/test";

export interface TestApplication {
  url: string;
  setupToken: string;
  password: string;
  restart: () => Promise<void>;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to allocate a local browser test port.");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

export const test = base.extend<{
  application: TestApplication;
  allowLocalProducts: boolean;
}>({
  allowLocalProducts: [false, { option: true }],
  application: [
    async ({ browserName, allowLocalProducts }, runTests) => {
      if (browserName !== "chromium") {
        throw new Error(
          "The real passkey browser tests require Chromium's virtual authenticator.",
        );
      }
      const repository = process.cwd();
      const testData = path.join(repository, ".test-data");
      await mkdir(testData, { recursive: true });
      const directory = await mkdtemp(path.join(testData, "e2e-"));
      const port = await availablePort();
      const url = `http://localhost:${port}`;
      const setupToken = randomBytes(32).toString("hex");
      const password = randomBytes(24).toString("base64url");
      const authSecret = randomBytes(32).toString("hex");
      const encryptionKey = randomBytes(32).toString("base64");
      let child: ChildProcess | undefined;
      let output = "";

      function safeOutput(): string {
        return [setupToken, password, authSecret, encryptionKey].reduce(
          (text, secret) => text.replaceAll(secret, "[redacted]"),
          output,
        );
      }

      async function stop(): Promise<void> {
        if (!child || child.exitCode !== null || child.signalCode !== null) {
          return;
        }
        const running = child;
        const exited = once(running, "exit");
        function terminate(signal: NodeJS.Signals): void {
          if (running.pid && process.platform !== "win32") {
            process.kill(-running.pid, signal);
          } else {
            running.kill(signal);
          }
        }
        terminate("SIGTERM");
        const forceStop = setTimeout(() => terminate("SIGKILL"), 15_000);
        try {
          await exited;
        } finally {
          clearTimeout(forceStop);
          child = undefined;
        }
      }

      async function start(): Promise<void> {
        output = "";
        child = spawn(
          process.execPath,
          [
            path.join(repository, "node_modules/next/dist/bin/next"),
            "dev",
            "--hostname",
            "127.0.0.1",
            "--port",
            String(port),
          ],
          {
            cwd: repository,
            detached: process.platform !== "win32",
            env: {
              ...process.env,
              NODE_ENV: "development",
              NEXT_TELEMETRY_DISABLED: "1",
              CONTROL_TEST_BUILD: "1",
              CONTROL_URL: url,
              CONTROL_AUTH_SECRET: authSecret,
              CONTROL_ENCRYPTION_KEY: encryptionKey,
              CONTROL_SETUP_TOKEN: setupToken,
              DATABASE_PATH: path.join(directory, "control.db"),
              CONTROL_ALLOW_HTTP_ENDPOINTS: String(allowLocalProducts),
              CONTROL_ALLOW_PRIVATE_ENDPOINTS: String(allowLocalProducts),
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        child.on("error", (error: Error) => {
          output += `\n${error.message}`;
        });
        const capture = (chunk: Buffer): void => {
          output = (output + chunk.toString()).slice(-10_000);
        };
        child.stdout?.on("data", capture);
        child.stderr?.on("data", capture);

        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(
              `Browser test server exited before becoming ready.\n${safeOutput()}`,
            );
          }
          try {
            const response = await fetch(`${url}/api/health/ready`, {
              signal: AbortSignal.timeout(2_000),
            });
            if (response.ok) return;
          } catch {
            // The process is still starting or compiling its readiness route.
          }
          await delay(250);
        }
        throw new Error(
          `Browser test server did not become ready.\n${safeOutput()}`,
        );
      }

      try {
        await start();
        await runTests({
          url,
          setupToken,
          password,
          restart: async () => {
            await stop();
            await start();
          },
        });
      } finally {
        await stop();
        await rm(directory, { recursive: true, force: true });
      }
    },
    { timeout: 120_000 },
  ],
  baseURL: async ({ application }, provideValue) => {
    await provideValue(application.url);
  },
});

export { expect } from "@playwright/test";
