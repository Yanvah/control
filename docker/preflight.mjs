// Next loads instrumentation lazily. Run the application's compiled startup checks
// before opening a socket so configuration, migration, and audit failures stop boot.
process.env.NODE_ENV = "production";
process.env.NEXT_RUNTIME = "nodejs";
delete process.env.NEXT_PHASE;

try {
  const instrumentation = await import("../.next/server/instrumentation.js");
  await (instrumentation.default ?? instrumentation).register();
} catch {
  console.error(
    "Control startup validation failed. Check configuration, storage, migrations, and audit integrity. No configuration values were printed.",
  );
  process.exitCode = 1;
}
