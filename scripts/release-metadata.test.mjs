import assert from "node:assert/strict";
import { test } from "node:test";
import {
  releaseMetadata,
  validateReleaseVersion,
} from "./release-metadata.mjs";

test("release versions use canonical SemVer that can be a container tag", () => {
  for (const version of ["0.1.0", "1.12.0", "0.1.0-rc.1", "2.0.0-alpha-1"]) {
    assert.equal(validateReleaseVersion(version), version);
  }
  for (const version of [
    undefined,
    "v0.1.0",
    "01.0.0",
    "1.0.0-01",
    "latest",
    "1.0.0+build",
    "1.0.0\nimage=other",
    "$(id)",
    "1.0.0/../../",
    "1.0.0-" + "a".repeat(101),
  ]) {
    assert.throws(() => validateReleaseVersion(version));
  }
});

test("release metadata requires package, version tag, and revision agreement", () => {
  const input = {
    version: "0.1.0",
    packageVersion: "0.1.0",
    revision: "a".repeat(40),
    tagRevision: "a".repeat(40),
    repository: "Yanvah/Control",
  };
  assert.deepEqual(releaseMetadata(input), {
    version: "0.1.0",
    revision: input.revision,
    image: "ghcr.io/yanvah/control:v0.1.0",
  });
  assert.throws(() => releaseMetadata({ ...input, packageVersion: "0.2.0" }));
  assert.throws(() =>
    releaseMetadata({ ...input, tagRevision: "b".repeat(40) }),
  );
  assert.throws(() =>
    releaseMetadata({ ...input, revision: "main", tagRevision: "main" }),
  );
  assert.throws(() =>
    releaseMetadata({ ...input, repository: "owner/repo\nother=value" }),
  );
});
