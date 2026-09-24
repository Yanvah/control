import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
await stat(path.join(standalone, "server.js"));
const scripts = path.join(root, ".container-scripts");
const licenses = path.join(root, ".container-licenses");
await rm(scripts, { recursive: true, force: true });
await rm(licenses, { recursive: true, force: true });
await mkdir(scripts, { recursive: true });
await mkdir(licenses, { recursive: true });
for (const name of ["database-maintenance.mjs", "database-policy.mjs"]) {
  await cp(path.join(root, "scripts", name), path.join(scripts, name));
}

const packages = [];
async function preserveLicenses(directory, relative = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    const destination = path.join(relative, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules")
      await preserveLicenses(filename, destination);
    else if (
      entry.isFile() &&
      /^(?:licen[sc]e|notice|copying)(?:[._-]|$)/i.test(entry.name)
    ) {
      await mkdir(path.dirname(path.join(licenses, destination)), {
        recursive: true,
      });
      await cp(filename, path.join(licenses, destination));
    }
  }
}
async function collect(directory, relative = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = path.join(relative, entry.name);
    const installed = path.join(directory, entry.name);
    const manifest = await readFile(
      path.join(installed, "package.json"),
      "utf8",
    )
      .then(JSON.parse)
      .catch(() => null);
    if (manifest?.name && manifest.version) {
      packages.push({
        name: manifest.name,
        version: manifest.version,
        license: manifest.license ?? "See bundled license files",
      });
      // Tracing may omit notices; retain them from the matching installed package.
      await preserveLicenses(path.join(root, "node_modules", name), name);
      const nested = path.join(installed, "node_modules");
      if (
        await stat(nested)
          .then((entry) => entry.isDirectory())
          .catch(() => false)
      )
        await collect(nested, path.join(name, "node_modules"));
    } else {
      await collect(installed, name);
    }
  }
}
await collect(path.join(standalone, "node_modules"));
await writeFile(
  path.join(licenses, "packages.json"),
  JSON.stringify(
    packages.sort((a, b) => a.name.localeCompare(b.name)),
    null,
    2,
  ) + "\n",
);
// Build tooling is not needed in the deployed application's manifest.
const manifestPath = path.join(standalone, "package.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
delete manifest.devDependencies;
delete manifest.scripts;
delete manifest.overrides;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.info(
  `Prepared standalone runtime and preserved notices for ${packages.length} runtime packages.`,
);
