import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sdkDirectory = path.resolve(
  repository,
  process.argv[2] ?? "../yanvah-control-sdk",
);
const destination = path.join(repository, "node_modules/@yanvah/control");

try {
  const applicationManifest = JSON.parse(
    await readFile(path.join(repository, "package.json"), "utf8"),
  );
  const sdkVersion = applicationManifest.dependencies?.["@yanvah/control"];
  if (typeof sdkVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(sdkVersion))
    throw new Error(
      "The application must pin an exact @yanvah/control version.",
    );
  const manifest = JSON.parse(
    await readFile(path.join(sdkDirectory, "package.json"), "utf8"),
  );
  if (manifest.name !== "@yanvah/control" || manifest.version !== sdkVersion) {
    throw new Error(
      `The local SDK must be @yanvah/control version ${sdkVersion}.`,
    );
  }
  for (const entry of [
    "dist/index.js",
    "dist/client/index.js",
    "dist/server/index.js",
    "dist/index.d.ts",
    "dist/client/index.d.ts",
    "dist/server/index.d.ts",
  ]) {
    await readFile(path.join(sdkDirectory, entry));
  }
  const existing = await lstat(destination).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing) {
    if (
      existing.isSymbolicLink() &&
      (await realpath(destination)) === (await realpath(sdkDirectory))
    ) {
      console.info("The local @yanvah/control package is already linked.");
      process.exit(0);
    }
    const installed = JSON.parse(
      await readFile(path.join(destination, "package.json"), "utf8"),
    );
    if (
      installed.name !== "@yanvah/control" ||
      installed.version !== sdkVersion
    )
      throw new Error("Refusing to replace an unexpected installed package.");
    // npm ci restores this exact published dependency; remove only its package directory.
    await rm(destination, { recursive: true });
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await symlink(
    path.relative(path.dirname(destination), sdkDirectory),
    destination,
    "junction",
  );
  console.info(
    `Linked the local @yanvah/control ${sdkVersion} build. Run npm ci to restore the published package.`,
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Unable to link the SDK.",
  );
  console.error(
    "Build the matching sibling SDK first, or run npm ci to use the published package. See README.md.",
  );
  process.exitCode = 1;
}
