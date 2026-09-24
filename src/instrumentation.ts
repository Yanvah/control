export async function register(): Promise<void> {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { getEnv } = await import("@/lib/env");
    getEnv();
    const { initializeDatabase } = await import("@/db/client");
    initializeDatabase();
    const { assertSetupConfiguration } = await import("@/lib/auth/setup");
    assertSetupConfiguration();
    const { initializeAudit } = await import("@/lib/audit/store");
    initializeAudit();
  }
}
