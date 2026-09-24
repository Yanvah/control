import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const numericIdentifier = "(?:0|[1-9][0-9]*)";
const prereleaseIdentifier = `(?:${numericIdentifier}|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`;
const versionPattern = new RegExp(
  `^${numericIdentifier}\\.${numericIdentifier}\\.${numericIdentifier}(?:-${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*)?$`,
);

export function validateReleaseVersion(value) {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    !versionPattern.test(value)
  ) {
    throw new Error(
      "Use an exact SemVer version without a v prefix or build metadata.",
    );
  }
  return value;
}

export function releaseMetadata({
  version,
  packageVersion,
  revision,
  tagRevision,
  repository,
}) {
  validateReleaseVersion(version);
  if (version !== packageVersion) {
    throw new Error("The release version must match package.json.");
  }
  if (!/^[a-f0-9]{40}$/.test(revision ?? "") || tagRevision !== revision) {
    throw new Error(
      "The existing version tag must point to the selected default-branch revision.",
    );
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("A valid GitHub repository is required.");
  }
  return {
    version,
    revision,
    image: `ghcr.io/${repository.toLowerCase()}:v${version}`,
  };
}

async function main() {
  if (
    !process.env.CONTROL_DEFAULT_BRANCH ||
    process.env.GITHUB_REF !==
      `refs/heads/${process.env.CONTROL_DEFAULT_BRANCH}`
  ) {
    throw new Error(
      "Release dispatch must run from the repository's default branch.",
    );
  }
  const version = validateReleaseVersion(process.env.CONTROL_RELEASE_VERSION);
  const repositoryPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const manifest = JSON.parse(
    await readFile(path.join(repositoryPath, "package.json"), "utf8"),
  );
  let tagRevision;
  try {
    tagRevision = execFileSync(
      "git",
      [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `refs/tags/v${version}^{commit}`,
      ],
      {
        cwd: repositoryPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch {
    throw new Error(
      "Create and review the exact version tag before dispatching a release.",
    );
  }
  const metadata = releaseMetadata({
    version,
    packageVersion: manifest.version,
    revision: process.env.GITHUB_SHA,
    tagRevision,
    repository: process.env.GITHUB_REPOSITORY,
  });
  if (!process.env.GITHUB_OUTPUT)
    throw new Error("GitHub Actions output is unavailable.");
  await appendFile(
    process.env.GITHUB_OUTPUT,
    Object.entries(metadata)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
  console.info(
    `Release checks passed for ${metadata.image} at ${metadata.revision}.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Release checks failed.",
    );
    process.exitCode = 1;
  });
}
