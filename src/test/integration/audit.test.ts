import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

mkdirSync(".test-data", { recursive: true });
const directory = mkdtempSync(join(process.cwd(), ".test-data", "audit-"));
const setupToken = randomBytes(32).toString("hex");
const authSecret = randomBytes(32).toString("hex");
const encryptionKey = randomBytes(32).toString("base64");
const password = randomBytes(24).toString("base64url");
const origin = "http://localhost:3000";
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    NODE_ENV: "test",
    CONTROL_URL: origin,
    CONTROL_AUTH_SECRET: authSecret,
    CONTROL_ENCRYPTION_KEY: encryptionKey,
    CONTROL_SETUP_TOKEN: setupToken,
    DATABASE_PATH: join(directory, "control.db"),
    CONTROL_ALLOW_HTTP_ENDPOINTS: true,
    CONTROL_ALLOW_PRIVATE_ENDPOINTS: true,
  }),
}));
import {
  initializeDatabase,
  closeDatabase,
  getDatabase,
  getSqlite,
} from "@/db/client";
import {
  auditEvents,
  authThrottle,
  session,
  products,
  operationEvents,
} from "@/db/schema";
import {
  initializeAudit,
  startAudit,
  finishAudit,
  verifyAuditChain,
} from "@/lib/audit/store";
import {
  auditEventSequence,
  listAuditEvents,
  parseAuditFilters,
} from "@/lib/audit/query";
import { redactAuditMetadata, targetReference } from "@/lib/audit/redaction";
import { logSecurityEvent } from "@/lib/audit/logging";
import { POST as setupPost } from "@/app/api/setup/route";
import { POST as authPost } from "@/app/api/auth/[...all]/route";
import { POST as productPost } from "@/app/api/products/route";
import { PATCH as productPatch } from "@/app/api/products/[id]/route";
import { GET as auditGet } from "@/app/api/audit/route";
import { GET as integrityGet } from "@/app/api/audit/integrity/route";

let cookie = "";
let productId = "";
const logLines: string[] = [];
const productSecret = randomBytes(32).toString("hex");
function request(
  path: string,
  body?: unknown,
  authenticated = true,
  requestOrigin = origin,
  method = body === undefined ? "GET" : "POST",
): Request {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      Origin: requestOrigin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(authenticated && cookie ? { Cookie: cookie } : {}),
      "X-Request-ID": "attacker-controlled-correlation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function resetLimits(): void {
  getDatabase().delete(authThrottle).run();
}
beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
});
beforeAll(() => {
  initializeDatabase();
  initializeAudit();
});
function restartInstance(): void {
  closeDatabase();
  // A real restart also discards Better Auth's adapter bound to the old handle.
  delete (globalThis as typeof globalThis & { controlAuth?: unknown })
    .controlAuth;
  initializeDatabase();
  initializeAudit();
}
afterAll(() => {
  vi.restoreAllMocks();
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

describe("audit security boundary", { concurrent: false }, () => {
  it("records setup and rejected origins without retaining inputs or trusting correlation headers", async () => {
    const input = {
      setupToken,
      name: "Owner",
      email: "owner@example.com",
      password,
    };
    const rejected = await setupPost(
      request("/api/setup", input, false, "https://attacker.example"),
    );
    expect(rejected.status).toBe(403);
    const response = await setupPost(request("/api/setup", input, false));
    expect(response.status).toBe(201);
    const id = response.headers.get("x-request-id");
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
    expect(id).not.toBe("attacker-controlled-correlation");
    const recorded = listAuditEvents({ outcome: "all", requestId: id! }).events;
    expect(recorded.map((event) => event.eventType)).toEqual([
      "succeeded",
      "requested",
    ]);
    expect(recorded[0].actorId).toMatch(/^[a-f0-9-]{36}$/);
    expect(listAuditEvents({ outcome: "failed" }).events[0].safeCode).toBe(
      "INVALID_ORIGIN",
    );
  });

  it("records real successful and failed logins with no password, cookie, or email", async () => {
    const denied = await authPost(
      request(
        "/api/auth/sign-in/email",
        { email: "owner@example.com", password: "wrong-password" },
        false,
      ),
    );
    expect(denied.status).toBe(401);
    const response = await authPost(
      request(
        "/api/auth/sign-in/email",
        { email: "owner@example.com", password },
        false,
      ),
    );
    expect(response.status).toBe(200);
    cookie = response.headers
      .getSetCookie()
      .find((entry) => entry.includes("session_token="))!
      .split(";")[0];
    const events = listAuditEvents({
      outcome: "completed",
      action: "auth.login.password",
    }).events;
    expect(events.map((event) => event.eventType)).toEqual([
      "succeeded",
      "failed",
    ]);
    expect(events[0].actorId).toMatch(/^[a-f0-9-]{36}$/);
    expect(events[1].actorId).toBeNull();
  });

  it("covers registry changes, stale sessions, CSRF, unsafe destinations, and anonymous requests", async () => {
    const body = {
      name: "Test product",
      endpoint: "http://127.0.0.1:3001/control",
      credentials: { mode: "existing", keyId: "test", secret: productSecret },
    };
    expect(
      (await productPost(request("/api/products", body, false))).status,
    ).toBe(401);
    expect(
      (
        await productPost(
          request("/api/products", body, true, "https://attacker.example"),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await productPost(
          request("/api/products", {
            ...body,
            endpoint: "http://169.254.169.254/metadata",
          }),
        )
      ).status,
    ).toBe(400);
    const response = await productPost(request("/api/products", body));
    expect(response.status).toBe(201);
    const data = await response.json();
    productId = data.product.id;
    const context = { params: Promise.resolve({ id: productId }) };
    expect(
      (
        await productPatch(
          request(
            `/api/products/${productId}`,
            { enabled: false },
            true,
            origin,
            "PATCH",
          ),
          context,
        )
      ).status,
    ).toBe(200);
    const event = listAuditEvents({
      outcome: "succeeded",
      action: "product.disable",
      productId,
    }).events[0];
    expect(auditEventSequence(event.id).map((row) => row.eventType)).toEqual([
      "requested",
      "succeeded",
    ]);
    getDatabase()
      .update(session)
      .set({ createdAt: new Date(Date.now() - 6 * 60_000) })
      .run();
    expect(
      (
        await productPatch(
          request(
            `/api/products/${productId}`,
            { enabled: true },
            true,
            origin,
            "PATCH",
          ),
          context,
        )
      ).status,
    ).toBe(403);
    expect(
      listAuditEvents({ outcome: "failed", action: "product.update" }).events[0]
        .safeCode,
    ).toBe("RECENT_AUTHENTICATION_REQUIRED");
    getDatabase().update(session).set({ createdAt: new Date() }).run();
    expect(verifyAuditChain().valid).toBe(true);
  });

  it("authenticates and bounds filtered history and integrity reads", async () => {
    expect(
      (await auditGet(request("/api/audit", undefined, false))).status,
    ).toBe(401);
    expect(
      (
        await auditGet(
          request("/api/audit", undefined, true, "https://attacker.example"),
        )
      ).status,
    ).toBe(403);
    expect((await auditGet(request("/api/audit?before=-1"))).status).toBe(400);
    expect((await auditGet(request("/api/audit?from=2026-02-31"))).status).toBe(
      400,
    );
    expect(
      (await auditGet(request("/api/audit?from=2026-09-20&to=2026-01-01")))
        .status,
    ).toBe(400);
    const result = await auditGet(
      request(
        `/api/audit?outcome=succeeded&action=product.disable&productId=${productId}`,
      ),
    );
    expect(result.status).toBe(200);
    expect((await result.json()).events).toHaveLength(1);
    const integrity = await integrityGet(request("/api/audit/integrity"));
    expect(await integrity.json()).toMatchObject({ valid: true });
  });

  it("rate limits login and setup while recording the safe rejection", async () => {
    resetLimits();
    getDatabase()
      .insert(authThrottle)
      .values({ key: "login", count: 20, windowStartedAt: Date.now() })
      .run();
    getDatabase()
      .insert(authThrottle)
      .values({ key: "setup", count: 10, windowStartedAt: Date.now() })
      .run();
    expect(
      (
        await authPost(
          request(
            "/api/auth/sign-in/email",
            { email: "owner@example.com", password },
            false,
          ),
        )
      ).status,
    ).toBe(429);
    expect((await setupPost(request("/api/setup", {}, false))).status).toBe(
      429,
    );
    expect(
      listAuditEvents({ outcome: "failed" })
        .events.slice(0, 2)
        .every((event) => event.safeCode === "TOO_MANY_ATTEMPTS"),
    ).toBe(true);
    resetLimits();
  });

  it("allowlists log metadata and pseudonymizes arbitrary target strings", () => {
    const metadata = {
      status: 200,
      password,
      headers: { authorization: cookie },
      secret: productSecret,
      response: { nested: password },
      credentialMode: "existing" as const,
    };
    expect(redactAuditMetadata(metadata)).toEqual({
      status: 200,
      credentialMode: "existing",
    });
    const record = startAudit({
      action: "users.ban",
      targetType: "user",
      targetId: password,
      metadata,
    });
    finishAudit(
      record,
      "failed",
      `error containing ${productSecret}`,
      metadata,
    );
    expect(record.targetId).toBe(targetReference(password));
    logSecurityEvent({
      requestId: cookie,
      action: password,
      outcome: "failed",
      code: productSecret,
      metadata,
    });
    const serialized =
      JSON.stringify(getDatabase().select().from(auditEvents).all()) +
      logLines.join("\n");
    for (const secret of [
      setupToken,
      authSecret,
      encryptionKey,
      password,
      productSecret,
      cookie,
      "owner@example.com",
    ])
      expect(serialized).not.toContain(secret);
  });

  it("uses stable bounded pagination and preserves unfinished intent as unknown after restart", () => {
    for (let i = 0; i < 55; i++) {
      const record = startAudit({ action: "product.test" });
      finishAudit(record, "succeeded");
    }
    const first = listAuditEvents(
      parseAuditFilters({ action: "product.test" }),
    );
    expect(first.events).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = listAuditEvents(
      parseAuditFilters({ action: "product.test", before: first.nextCursor }),
    );
    expect(second.events).toHaveLength(5);
    expect(
      new Set([...first.events, ...second.events].map((event) => event.id))
        .size,
    ).toBe(55);
    const pending = startAudit({
      action: "product.remove",
      productId: randomUUID(),
    });
    restartInstance();
    expect(
      auditEventSequence(pending.id).map((event) => event.eventType),
    ).toEqual(["requested", "unknown"]);
    expect(auditEventSequence(pending.id)[1].safeCode).toBe(
      "PROCESS_INTERRUPTED",
    );
    initializeAudit();
    expect(auditEventSequence(pending.id)).toHaveLength(2);
    expect(verifyAuditChain().valid).toBe(true);
  });

  it("imports legacy receipts once, preserving their timestamps and redacting raw target IDs", () => {
    const attemptId = randomUUID();
    const requestId = randomUUID();
    const createdAt = new Date("2026-01-02T03:04:05.000Z");
    const completedAt = new Date(createdAt.getTime() + 150);
    const receipt = {
      id: randomUUID(),
      attemptId,
      actorId: randomUUID(),
      productId,
      operation: "users.ban",
      targetId: "legacy-user@example.com",
      inputFingerprint: "a".repeat(64),
      eventType: "requested" as const,
      requestId: null,
      safeCode: null,
      durationMs: null,
      createdAt,
    };
    getDatabase().insert(operationEvents).values(receipt).run();
    getDatabase()
      .insert(operationEvents)
      .values({
        ...receipt,
        id: randomUUID(),
        eventType: "succeeded",
        requestId,
        createdAt: completedAt,
        durationMs: 150,
      })
      .run();
    initializeAudit();
    initializeAudit();
    const events = getDatabase()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.attemptId, attemptId))
      .all();
    expect(events.map((event) => event.eventType)).toEqual([
      "requested",
      "succeeded",
    ]);
    expect(events.map((event) => event.createdAt)).toEqual([
      createdAt,
      completedAt,
    ]);
    expect(events[1].durationMs).toBe(150);
    expect(JSON.parse(events[1].metadataJson)).toEqual({
      imported: true,
      sdkRequestId: requestId,
    });
    expect(events[0].targetId).toBe(targetReference(receipt.targetId));
    expect(JSON.stringify(events)).not.toContain(receipt.targetId);
    expect(verifyAuditChain().valid).toBe(true);
  });

  it("prevents updates/deletes and fails closed before a mutation if audit insertion fails", async () => {
    expect(() =>
      getSqlite().exec("UPDATE audit_events SET action = 'auth.rejected'"),
    ).toThrow("append-only");
    expect(() => getSqlite().exec("DELETE FROM audit_events")).toThrow(
      "append-only",
    );
    getSqlite().exec(
      "CREATE TRIGGER audit_test_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'test storage failure'); END;",
    );
    const response = await productPatch(
      request(
        `/api/products/${productId}`,
        { enabled: true },
        true,
        origin,
        "PATCH",
      ),
      { params: Promise.resolve({ id: productId }) },
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("AUDIT_UNAVAILABLE");
    expect(
      getDatabase()
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .get()?.enabled,
    ).toBe(false);
    getSqlite().exec("DROP TRIGGER audit_test_failure");
  });

  it("keeps an unknown outcome when audit completion fails after a local mutation", async () => {
    getSqlite().exec(
      "CREATE TRIGGER audit_test_terminal_failure BEFORE INSERT ON audit_events WHEN NEW.event_type != 'requested' BEGIN SELECT RAISE(ABORT, 'test completion failure'); END;",
    );
    const response = await productPatch(
      request(
        `/api/products/${productId}`,
        { enabled: true },
        true,
        origin,
        "PATCH",
      ),
      { params: Promise.resolve({ id: productId }) },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "AUDIT_UNAVAILABLE" });
    expect(
      getDatabase()
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .get()?.enabled,
    ).toBe(true);
    const requestId = response.headers.get("x-request-id")!;
    expect(
      listAuditEvents({ outcome: "all", requestId }).events.map(
        (event) => event.eventType,
      ),
    ).toEqual(["requested"]);
    const logs = logLines
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.requestId === requestId);
    expect(logs.map((entry) => entry.outcome)).toEqual(["unknown"]);
    getSqlite().exec("DROP TRIGGER audit_test_terminal_failure");
    restartInstance();
    const recovered = listAuditEvents({ outcome: "all", requestId }).events;
    expect(recovered.map((event) => event.eventType)).toEqual([
      "unknown",
      "requested",
    ]);
    expect(recovered[0].safeCode).toBe("PROCESS_INTERRUPTED");
    expect(verifyAuditChain().valid).toBe(true);
  });

  it("detects offline modification of a middle event and refuses startup", () => {
    const record = getDatabase().select().from(auditEvents).get()!;
    getSqlite().exec("DROP TRIGGER audit_events_no_update");
    getDatabase()
      .update(auditEvents)
      .set({ action: "product.remove" })
      .where(eq(auditEvents.id, record.id))
      .run();
    expect(verifyAuditChain().valid).toBe(false);
    expect(() => initializeAudit()).toThrow("AUDIT_INTEGRITY_FAILED");
  });
});
