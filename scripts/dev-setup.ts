import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

if (
  process.argv.slice(2).join(" ") !== "--local" ||
  (process.env.NODE_ENV && process.env.NODE_ENV !== "development")
) {
  console.error(
    "Development setup requires --local and refuses non-development NODE_ENV. It never creates an owner.",
  );
  process.exit(1);
}

const contents = [
  "# Local development only. Do not copy this file into a production deployment.",
  "CONTROL_URL=http://localhost:3000",
  `CONTROL_AUTH_SECRET=${randomBytes(32).toString("base64")}`,
  `CONTROL_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
  `CONTROL_SETUP_TOKEN=${randomBytes(32).toString("base64")}`,
  "DATABASE_PATH=./.data/control.db",
  "CONTROL_ALLOW_HTTP_ENDPOINTS=false",
  "CONTROL_ALLOW_PRIVATE_ENDPOINTS=false",
  "",
].join("\n");

try {
  writeFileSync(resolve(process.cwd(), ".env.local"), contents, {
    flag: "wx",
    mode: 0o600,
  });
  console.info(
    "Created .env.local with independent local secrets. Run npm run dev, then open http://localhost:3000/setup. Read CONTROL_SETUP_TOKEN from .env.local when claiming the instance.",
  );
} catch {
  console.error(
    "Could not create .env.local. Existing configuration is never overwritten.",
  );
  process.exit(1);
}
