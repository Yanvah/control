import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import Database from "better-sqlite3";
import { verifyDatabase } from "./database-policy.mjs";

const migrationsFolder = fileURLToPath(
  new URL("../src/db/migrations/", import.meta.url),
);
let source;
let destination;
let created = false;

function storagePath(value) {
  const path = resolve(value);
  if (
    process.env.NODE_ENV === "production" &&
    (!isAbsolute(value) || !path.startsWith("/data/"))
  )
    throw new Error("Production paths must be below /data.");
  // Refuse symlinks so a backup/restore cannot escape the selected storage tree.
  for (let entry = path; entry !== dirname(entry); entry = dirname(entry)) {
    if (existsSync(entry) && lstatSync(entry).isSymbolicLink())
      throw new Error("Symbolic links are not supported for database storage.");
  }
  return path;
}

function readDatabase(path) {
  if (!lstatSync(path).isFile())
    throw new Error("Expected a regular database file.");
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  try {
    sqlite.pragma("busy_timeout = 5000");
    verifyDatabase(sqlite, migrationsFolder);
    return sqlite;
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

try {
  const { values, positionals } = parseArgs({
    options: {
      offline: { type: "boolean" },
      input: { type: "string" },
      output: { type: "string" },
    },
    strict: true,
    allowPositionals: true,
  });
  const [command] = positionals;
  if (
    positionals.length !== 1 ||
    !["backup", "verify", "restore"].includes(command)
  )
    throw new Error("Invalid command.");
  if (command === "verify") {
    if (!values.input || values.output || values.offline)
      throw new Error("verify requires only --input.");
    source = readDatabase(storagePath(values.input));
    console.info(
      "Backup verified: SQLite integrity, relationships, and migration history. The application verifies audit hashes with the retained encryption key at startup.",
    );
  } else {
    if (!values.offline)
      throw new Error(
        "Stop the application first and explicitly pass --offline.",
      );
    const databasePath = storagePath(
      process.env.DATABASE_PATH || "/data/control.db",
    );
    if (command === "backup" && (!values.output || values.input))
      throw new Error("backup requires --output.");
    if (command === "restore" && (!values.input || values.output))
      throw new Error("restore requires --input.");
    const input =
      command === "backup" ? databasePath : storagePath(values.input);
    destination =
      command === "backup" ? storagePath(values.output) : databasePath;
    if (input === destination)
      throw new Error("Source and destination must differ.");
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      if (existsSync(`${destination}${suffix}`))
        throw new Error(
          "Destination already exists. Restore only into a fresh data volume; never overwrite a database.",
        );
    }
    source = readDatabase(input);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    if (realpathSync(dirname(destination)) !== dirname(destination))
      throw new Error("Symbolic links are not supported for database storage.");
    // Reserve the filename exclusively, including against another maintenance process.
    closeSync(openSync(destination, "wx", 0o600));
    created = true;
    await source.backup(destination);
    // A portable snapshot must open on a read-only backup mount without WAL/SHM.
    const finalized = new Database(destination, { fileMustExist: true });
    try {
      finalized.pragma("journal_mode = DELETE");
    } finally {
      finalized.close();
    }
    const snapshot = readDatabase(destination);
    snapshot.close();
    console.info(
      command === "backup"
        ? "Backup created and verified. Copy it to protected off-host storage and retain matching authentication/encryption keys separately."
        : "Database restored and verified. Start the matching application image with the retained authentication/encryption keys; startup verifies audit hashes before serving traffic.",
    );
    created = false;
  }
} catch {
  if (created && destination) {
    for (const suffix of ["", "-wal", "-shm", "-journal"])
      rmSync(`${destination}${suffix}`, { force: true });
  }
  console.error(
    "Database maintenance failed. Stop the application and use backup --offline --output FILE, verify --input FILE, or restore --offline --input FILE. Check storage permissions, a compatible image, and database integrity. Destination files are never overwritten. Production paths must be under /data; restore requires a fresh target volume. No configuration values were printed.",
  );
  process.exitCode = 1;
} finally {
  source?.close();
}
