import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  serveOperationalProduct,
  type OperationalProduct,
} from "../fixtures/operational-product";

mkdirSync(".test-data", { recursive: true });
const directory = mkdtempSync(
  join(process.cwd(), ".test-data", "user-operations-"),
);
const databasePath = join(directory, "control.db");
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
    DATABASE_PATH: databasePath,
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
  operationEvents,
  session,
} from "@/db/schema";
import {
  registerProduct,
  setProductEnabled,
  removeProduct,
  testProductConnection,
} from "@/lib/products/service";
import { searchUsers, searchProduct, getUserDetail } from "@/lib/users/service";
import {
  executeOperation,
  getOperationOutcome,
} from "@/lib/operations/service";
import {
  mutationRequestSchema,
  type MutationRequest,
} from "@/lib/users/models";
import { POST as setupPost } from "@/app/api/setup/route";
import { POST as authPost } from "@/app/api/auth/[...all]/route";
import { POST as searchPost } from "@/app/api/users/search/route";
import { POST as operationPost } from "@/app/api/products/[id]/operations/route";
import { GET as outcomeGet } from "@/app/api/operations/[attemptId]/route";

let first: OperationalProduct;
let second: OperationalProduct;
let firstId: string;
let secondId: string;
let cookie: string;
let actor: { id: string; email: string };
function browser(
  path: string,
  body?: unknown,
  options: { origin?: string; authenticated?: boolean } = {},
): Request {
  return new Request(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: options.origin ?? origin,
      ...(options.authenticated === false ? {} : { Cookie: cookie ?? "" }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function mutation(
  productId: string,
  operation: MutationRequest["operation"],
  input: unknown,
  confirmation = "",
): Promise<MutationRequest> {
  const detail = await getUserDetail(productId, "user_123", actor);
  return mutationRequestSchema.parse({
    operation,
    input,
    confirmation,
    confirmed: true,
    attemptId: randomUUID(),
    capabilityVersion: detail.capabilityVersion,
  });
}
function events(attemptId: string): (typeof operationEvents.$inferSelect)[] {
  return getDatabase()
    .select()
    .from(operationEvents)
    .where(eq(operationEvents.attemptId, attemptId))
    .all();
}

beforeAll(async () => {
  initializeDatabase();
  const setup = await setupPost(
    browser(
      "/api/setup",
      { setupToken, name: "Owner", email: "owner@example.com", password },
      { authenticated: false },
    ),
  );
  expect(setup.status).toBe(201);
  const login = await authPost(
    browser(
      "/api/auth/sign-in/email",
      { email: "owner@example.com", password },
      { authenticated: false },
    ),
  );
  expect(login.status).toBe(200);
  cookie = login.headers
    .getSetCookie()
    .find((value) => value.includes("session_token="))!
    .split(";")[0];
  const payload = (await login.json()) as {
    user: { id: string; email: string };
  };
  actor = { id: payload.user.id, email: payload.user.email };
  first = await serveOperationalProduct("atlas", "Atlas SaaS", true);
  second = await serveOperationalProduct("beacon", "Beacon SaaS", false);
  firstId = (
    await registerProduct({
      name: "Atlas",
      endpoint: first.endpoint,
      credentials: { mode: "existing", ...first.credentials },
    })
  ).product.id;
  secondId = (
    await registerProduct({
      name: "Beacon",
      endpoint: second.endpoint,
      credentials: { mode: "existing", ...second.credentials },
    })
  ).product.id;
});
beforeEach(() => {
  getDatabase().delete(authThrottle).run();
  getDatabase().update(session).set({ createdAt: new Date() }).run();
  first.setMode("online");
  second.setMode("online");
  setProductEnabled(firstId, true);
  setProductEnabled(secondId, true);
});
afterAll(async () => {
  await first?.close();
  await second?.close();
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

describe("user operations through real signed HTTP SDK requests", () => {
  it("falls back to signed v1 discovery for an existing product", async () => {
    second.setMode("v1-only");
    const connected = await testProductConnection(secondId);
    expect(connected.capabilities?.protocolVersion).toBe("1");
    expect(connected.capabilities?.operations).not.toContain("users.create");
    expect(
      (
        await searchProduct(
          { id: secondId, name: "Beacon" },
          "john@example.com",
          actor,
        )
      ).state,
    ).toBe("found");
  });
  it("creates a user only in a capable product and reports definite duplicates", async () => {
    const email = "new-person@example.com";
    const before = first.mutationCount();
    const request = await mutation(firstId, "users.create", {
      email,
      name: "New Person",
    });
    const result = await executeOperation(firstId, request, actor);
    expect(result).toMatchObject({
      state: "succeeded",
      output: { user: { email, name: "New Person" } },
    });
    expect(first.created(email)?.id).toBe("created_1");
    expect(second.created(email)).toBeUndefined();
    expect(first.mutationCount()).toBe(before + 1);
    expect(await executeOperation(firstId, request, actor)).toMatchObject({
      state: "succeeded",
    });
    expect(first.mutationCount()).toBe(before + 1);
    const duplicate = await mutation(firstId, "users.create", { email });
    expect(await executeOperation(firstId, duplicate, actor)).toMatchObject({
      state: "failed",
      code: "USER_ALREADY_EXISTS",
    });
    const unsupported = await mutation(secondId, "users.create", {
      email: "other@example.com",
    });
    expect(await executeOperation(secondId, unsupported, actor)).toMatchObject({
      state: "failed",
      code: "OPERATION_UNSUPPORTED",
    });
    const history = JSON.stringify({
      receipts: getDatabase().select().from(operationEvents).all(),
      audit: getDatabase().select().from(auditEvents).all(),
    });
    expect(history).not.toContain(email);
    expect(history).not.toContain("New Person");
  });
  it("records a lost creation response as unknown without creating twice", async () => {
    const email = "lost-response@example.com";
    const request = await mutation(firstId, "users.create", { email });
    const before = first.mutationCount();
    first.setMode("lost-mutation");
    expect(await executeOperation(firstId, request, actor)).toMatchObject({
      state: "unknown",
    });
    expect(first.created(email)).toBeDefined();
    expect(await executeOperation(firstId, request, actor)).toMatchObject({
      state: "unknown",
    });
    expect(first.mutationCount()).toBe(before + 1);
    expect(getOperationOutcome(request.attemptId, actor.id).state).toBe(
      "unknown",
    );
  });
  it("blocks creation after a product is disabled or its capabilities change", async () => {
    const request = await mutation(firstId, "users.create", {
      email: "stale-create@example.com",
    });
    setProductEnabled(firstId, false);
    await expect(
      executeOperation(firstId, request, actor),
    ).rejects.toMatchObject({
      code: "PRODUCT_DISABLED",
    });
    expect(first.created("stale-create@example.com")).toBeUndefined();
    setProductEnabled(firstId, true);
    first.addAction();
    try {
      const stale = await executeOperation(firstId, request, actor);
      expect(stale).toMatchObject({
        state: "failed",
        code: "CAPABILITIES_CHANGED",
      });
      expect(first.created("stale-create@example.com")).toBeUndefined();
    } finally {
      first.removeAction();
    }
  });
  it("searches independent products and tolerates different optional fields", async () => {
    const results = await searchUsers("john@example.com", actor);
    expect(results.map((result) => result.state)).toEqual(["found", "found"]);
    expect(results[0]).toMatchObject({
      product: { id: firstId },
      users: [{ name: "John Atlas", banned: false }],
    });
    expect(results[1]).toMatchObject({
      product: { id: secondId },
      users: [{ id: "user_123" }],
    });
    expect(first.requests.at(-1)?.actor).toEqual(actor);
    expect(
      (await searchUsers("nobody@example.com", actor)).map(
        (result) => result.state,
      ),
    ).toEqual(["not_found", "not_found"]);
  });
  it("returns usable partial results and separates offline, unauthorized and malformed products", async () => {
    second.setMode("offline");
    expect(
      (await searchUsers("john@example.com", actor)).map(
        (result) => result.state,
      ),
    ).toEqual(["found", "offline"]);
    second.setMode("malformed");
    expect(
      (
        await searchProduct(
          { id: secondId, name: "Beacon" },
          "john@example.com",
          actor,
        )
      ).state,
    ).toBe("failed");
    const bad = (
      await registerProduct({
        name: "Wrong credential",
        endpoint: first.endpoint,
        credentials: { mode: "generate" },
      })
    ).product;
    try {
      expect((await searchProduct(bad, "john@example.com", actor)).state).toBe(
        "unauthorized",
      );
    } finally {
      removeProduct(bad.id, bad.name);
    }
  });
  it("loads actual user and subscription data without saving a user directory", async () => {
    const detail = await getUserDetail(firstId, "user_123", actor);
    expect(detail.user).toMatchObject({
      state: "ready",
      data: { email: "john@example.com" },
    });
    expect(detail.subscription).toMatchObject({
      state: "ready",
      data: { planId: "basic" },
    });
    expect((await getUserDetail(firstId, "missing", actor)).user).toEqual({
      state: "ready",
      data: null,
    });
    const tables = getSqlite()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all();
    expect(JSON.stringify(tables)).not.toContain("remote_users");
  });
  it("rejects unsupported forged operations and missing typed confirmation before dispatch", async () => {
    const count = first.mutationCount();
    const wrong = await mutation(
      firstId,
      "users.ban",
      { userId: "user_123" },
      "wrong",
    );
    expect(await executeOperation(firstId, wrong, actor)).toMatchObject({
      state: "failed",
      code: "CONFIRMATION_REQUIRED",
    });
    const unavailable = await mutation(
      secondId,
      "users.ban",
      { userId: "user_123" },
      "user_123",
    );
    expect(await executeOperation(secondId, unavailable, actor)).toMatchObject({
      state: "failed",
      code: "OPERATION_UNSUPPORTED",
    });
    expect(first.mutationCount()).toBe(count);
    expect(second.mutationCount()).toBe(0);
  });
  it("bans, unbans, revokes sessions and changes plans only in the selected product", async () => {
    const ban = await mutation(
      firstId,
      "users.ban",
      { userId: "user_123", reason: "Requested by owner" },
      "user_123",
    );
    expect(await executeOperation(firstId, ban, actor)).toMatchObject({
      state: "succeeded",
    });
    expect(first.user().banned).toBe(true);
    expect(second.user().banned).toBeUndefined();
    for (const [operation, input] of [
      ["users.unban", { userId: "user_123" }],
      ["users.revokeSessions", { userId: "user_123" }],
      ["subscriptions.changePlan", { userId: "user_123", planId: "pro" }],
    ] as const)
      expect(
        await executeOperation(
          firstId,
          await mutation(firstId, operation, input),
          actor,
        ),
      ).toMatchObject({ state: "succeeded" });
    expect(first.user().banned).toBe(false);
    expect(first.subscription().planId).toBe("pro");
    expect(second.subscription().planId).toBe("team");
    expect(
      events(ban.attemptId)
        .map((event) => event.eventType)
        .sort(),
    ).toEqual(["requested", "succeeded"]);
    expect(
      events(ban.attemptId).find((event) => event.eventType === "succeeded")
        ?.requestId,
    ).toMatch(/^[a-f0-9-]{36}$/);
  });
  it("validates product-specific action input and arbitrary JSON output through the SDK", async () => {
    const before = first.mutationCount();
    const bad = await mutation(
      firstId,
      "actions.invoke",
      { actionId: "grant-credit", input: { userId: "user_123", credits: 999 } },
      "Atlas",
    );
    expect(await executeOperation(firstId, bad, actor)).toMatchObject({
      state: "failed",
      code: "INVALID_INPUT",
    });
    expect(first.mutationCount()).toBe(before);
    const valid = await mutation(
      firstId,
      "actions.invoke",
      { actionId: "grant-credit", input: { userId: "user_123", credits: 3 } },
      "Atlas",
    );
    expect(await executeOperation(firstId, valid, actor)).toMatchObject({
      state: "succeeded",
      output: { granted: 3 },
    });
  });
  it("requires a new review when capability metadata changes and accepts a newly advertised action", async () => {
    const old = await mutation(firstId, "users.unban", { userId: "user_123" });
    first.addAction();
    expect(await executeOperation(firstId, old, actor)).toMatchObject({
      state: "failed",
      code: "CAPABILITIES_CHANGED",
    });
    const detail = await getUserDetail(firstId, undefined, actor);
    expect(
      detail.capabilities?.actions.some((action) => action.id === "new-action"),
    ).toBe(true);
    const request = mutationRequestSchema.parse({
      attemptId: randomUUID(),
      capabilityVersion: detail.capabilityVersion,
      operation: "actions.invoke",
      input: { actionId: "new-action", input: {} },
      confirmed: true,
      confirmation: "",
    });
    expect(await executeOperation(firstId, request, actor)).toMatchObject({
      state: "succeeded",
      output: { added: true },
    });
  });
  it("prevents concurrent and later duplicate attempts, including after restart", async () => {
    const request = await mutation(firstId, "users.revokeSessions", {
      userId: "user_123",
    });
    const before = first.mutationCount();
    const results = await Promise.all([
      executeOperation(firstId, request, actor),
      executeOperation(firstId, request, actor),
    ]);
    expect(results.map((result) => result.state).sort()).toEqual([
      "pending",
      "succeeded",
    ]);
    expect(first.mutationCount()).toBe(before + 1);
    closeDatabase();
    Reflect.deleteProperty(globalThis, "controlAuth");
    initializeDatabase();
    expect(await executeOperation(firstId, request, actor)).toMatchObject({
      state: "succeeded",
    });
    expect(first.mutationCount()).toBe(before + 1);
    await expect(
      executeOperation(
        firstId,
        { ...request, confirmation: "different" },
        actor,
      ),
    ).rejects.toMatchObject({ code: "ATTEMPT_CONFLICT" });
  });
  it("records an actually completed mutation with a lost response as unknown and never retries", async () => {
    const request = await mutation(
      firstId,
      "users.ban",
      { userId: "user_123" },
      "user_123",
    );
    first.setMode("lost-mutation");
    const before = first.mutationCount();
    expect(await executeOperation(firstId, request, actor)).toMatchObject({
      state: "unknown",
    });
    expect(first.user().banned).toBe(true);
    expect(first.mutationCount()).toBe(before + 1);
    expect(await executeOperation(firstId, request, actor)).toMatchObject({
      state: "unknown",
    });
    expect(first.mutationCount()).toBe(before + 1);
    expect(getOperationOutcome(request.attemptId, actor.id).state).toBe(
      "unknown",
    );
    expect(
      events(request.attemptId)
        .map((event) => event.eventType)
        .sort(),
    ).toEqual(["requested", "unknown"]);
  });
  it.each(["timeout-mutation", "throw-mutation"] as const)(
    "treats %s after dispatch as unknown",
    async (mode) => {
      const request = await mutation(
        firstId,
        "users.ban",
        { userId: "user_123" },
        "user_123",
      );
      first.setMode(mode);
      const count = first.mutationCount();
      expect(await executeOperation(firstId, request, actor)).toMatchObject({
        state: "unknown",
        code:
          mode === "timeout-mutation" ? "REQUEST_TIMEOUT" : "INTERNAL_ERROR",
      });
      expect(first.mutationCount()).toBe(count + 1);
      expect(first.user().banned).toBe(true);
    },
  );
  it("keeps operation events append-only and rejects credential-bearing remote output", async () => {
    const request = await mutation(
      firstId,
      "actions.invoke",
      { actionId: "grant-credit", input: { userId: "user_123", credits: 1 } },
      "Atlas",
    );
    first.setMode("secret-output");
    const result = await executeOperation(firstId, request, actor);
    expect(result).toMatchObject({
      state: "unknown",
      code: "INVALID_RESPONSE",
    });
    expect(JSON.stringify(result)).not.toContain(first.credentials.secret);
    const recorded = JSON.stringify(
      getDatabase().select().from(operationEvents).all(),
    );
    for (const secret of [
      first.credentials.secret,
      second.credentials.secret,
      authSecret,
      encryptionKey,
      setupToken,
    ])
      expect(recorded).not.toContain(secret);
    expect(recorded).not.toContain("Requested by owner");
    expect(recorded).not.toContain('"granted"');
    expect(() =>
      getDatabase().update(operationEvents).set({ safeCode: "tampered" }).run(),
    ).toThrow(/append-only/);
    expect(() => getDatabase().delete(operationEvents).run()).toThrow(
      /append-only/,
    );
  });
  it("authenticates, enforces CSRF and requires recent authentication at operation routes", async () => {
    const input = await mutation(firstId, "users.unban", {
      userId: "user_123",
    });
    const context = { params: Promise.resolve({ id: firstId }) };
    expect(
      (
        await operationPost(
          browser("/operation", input, { authenticated: false }),
          context,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await operationPost(
          browser("/operation", input, { origin: "https://evil.example" }),
          context,
        )
      ).status,
    ).toBe(403);
    getDatabase()
      .update(session)
      .set({ createdAt: new Date(Date.now() - 600_000) })
      .run();
    expect(
      (await operationPost(browser("/operation", input), context)).status,
    ).toBe(403);
    const search = { query: "john", channelId: randomUUID(), sequence: 1 };
    expect(
      (await searchPost(browser("/search", search, { authenticated: false })))
        .status,
    ).toBe(401);
    expect(
      (
        await outcomeGet(
          browser("/outcome", undefined, { authenticated: false }),
          { params: Promise.resolve({ attemptId: input.attemptId }) },
        )
      ).status,
    ).toBe(401);
  });
  it("cancels a replaced search and allows the new query to acquire the released slots", async () => {
    const channelId = randomUUID();
    const before = first.requests.length;
    const canceledBefore = first.canceledSearches();
    const old = searchPost(
      browser("/search", { query: "slow", channelId, sequence: 1 }),
    );
    await vi.waitFor(() => {
      expect(first.requests.length).toBeGreaterThan(before + 1);
      expect(first.requests.at(-1)?.operation).toBe("users.search");
    });
    const next = await searchPost(
      browser("/search", { query: "john@example.com", channelId, sequence: 2 }),
    );
    expect(next.status).toBe(200);
    expect(await next.json()).toMatchObject({
      results: [{ state: "found" }, { state: "found" }],
    });
    expect(await (await old).json()).toMatchObject({
      results: [{ state: "canceled" }, { state: "canceled" }],
    });
    await vi.waitFor(() =>
      expect(first.canceledSearches()).toBeGreaterThan(canceledBefore),
    );
    expect(
      (
        await searchPost(
          browser("/search", { query: "old", channelId, sequence: 1 }),
        )
      ).status,
    ).toBe(409);
  });
  it("cancels pending user reads when a product is disabled and excludes it from search", async () => {
    const initialCount = first.requests.length;
    const pending = searchProduct(
      { id: firstId, name: "Atlas" },
      "slow",
      actor,
    );
    await vi.waitFor(() => {
      expect(first.requests.length).toBeGreaterThan(initialCount + 1);
      expect(first.requests.at(-1)?.operation).toBe("users.search");
    });
    setProductEnabled(firstId, false);
    expect((await pending).state).toBe("canceled");
    const before = first.requests.length;
    expect(
      (await searchUsers("john@example.com", actor)).map(
        (result) => result.product.id,
      ),
    ).toEqual([secondId]);
    expect(first.requests.length).toBe(before);
  });
});
