import type { NextConfig } from "next";
import path from "node:path";
import { lstatSync } from "node:fs";

const linkedSdk = lstatSync(
  path.join(process.cwd(), "node_modules/@yanvah/control"),
  { throwIfNoEntry: false },
)?.isSymbolicLink();
const projectRoot =
  process.env.NODE_ENV === "development" || linkedSdk
    ? path.resolve(process.cwd(), "..")
    : process.cwd();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  output: "standalone",
  // Browser tests must not share the running developer server's build directory.
  distDir: process.env.CONTROL_TEST_BUILD === "1" ? ".next/test" : ".next",
  // A development SDK link can live outside the app; container builds install it locally.
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
  outputFileTracingIncludes: {
    "/*": [
      // A linked SDK includes a workspace self-link; trace only its runtime exports.
      "./node_modules/@yanvah/control/package.json",
      "./node_modules/@yanvah/control/dist/**",
      "./src/db/migrations/**",
      "./scripts/database-policy.mjs",
    ],
  },
  serverExternalPackages: ["better-sqlite3", "@yanvah/control"],
};

export default nextConfig;
