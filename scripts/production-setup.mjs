import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

try {
  const { values } = parseArgs({
    options: {
      production: { type: "boolean" },
      url: { type: "string" },
      output: { type: "string", default: ".env.production" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (!values.production || !values.url) throw new Error("arguments");
  const url = new URL(values.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("origin");

  const contents = [
    "# Keep this file private and back it up separately from the database.",
    "# Remove CONTROL_SETUP_TOKEN after claiming the instance; retain the other keys.",
    `CONTROL_URL=${url.origin}`,
    `CONTROL_AUTH_SECRET=${randomBytes(32).toString("base64")}`,
    `CONTROL_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
    `CONTROL_SETUP_TOKEN=${randomBytes(32).toString("base64")}`,
    "DATABASE_PATH=/data/control.db",
    "CONTROL_ALLOW_HTTP_ENDPOINTS=false",
    "CONTROL_ALLOW_PRIVATE_ENDPOINTS=false",
    "",
  ].join("\n");
  writeFileSync(resolve(values.output), contents, { flag: "wx", mode: 0o600 });
  console.info(
    "Created private production configuration. Back up this file separately; existing keys must stay stable. Read its setup token to claim the instance. No account was created.",
  );
} catch {
  console.error(
    "Production setup requires --production --url https://your-host [--output .env.production]. Use a bare HTTPS origin and a new output file. Existing configuration is never overwritten. No secrets were printed.",
  );
  process.exitCode = 1;
}
