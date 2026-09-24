import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  createControlHandler,
  createMemoryReplayStore,
  type ControlHandler,
} from "@yanvah/control/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type TestContext,
} from "vitest";

mkdirSync(join(process.cwd(), ".test-data"), { recursive: true });
const directory = mkdtempSync(join(process.cwd(), ".test-data", "products-"));
const databasePath = join(directory, "control.db");
const origin = "http://localhost:3000";
const setupToken = randomBytes(32).toString("hex");
const authSecret = randomBytes(32).toString("hex");
const encryptionKey = randomBytes(32).toString("base64");
const password = randomBytes(32).toString("hex");
let allowPrivate = true;
let cookie: string;

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    NODE_ENV: "test",
    CONTROL_URL: origin,
    CONTROL_AUTH_SECRET: authSecret,
    CONTROL_ENCRYPTION_KEY: encryptionKey,
    CONTROL_SETUP_TOKEN: setupToken,
    DATABASE_PATH: databasePath,
    CONTROL_ALLOW_HTTP_ENDPOINTS: true,
    CONTROL_ALLOW_PRIVATE_ENDPOINTS: allowPrivate,
  }),
}));

import { closeDatabase, getDatabase, initializeDatabase } from "@/db/client";
import { authThrottle, products, session } from "@/db/schema";
import { getAuth } from "@/lib/auth/server";
import { decryptProductSecret } from "@/lib/encryption/secrets";
import { credentialInputSchema } from "@/lib/products/input";
import {
  getProduct,
  listProducts,
  registerProduct,
  removeProduct,
  replaceProductCredentials,
  setProductEnabled,
  testProductConnection,
} from "@/lib/products/service";
import type { ProductWriteResult } from "@/lib/products/types";
import { POST as setupPost } from "@/app/api/setup/route";
import { POST as authPost } from "@/app/api/auth/[...all]/route";
import { GET as listGet, POST as createPost } from "@/app/api/products/route";
import {
  DELETE as deleteProduct,
  GET as detailGet,
  PATCH as updateProduct,
} from "@/app/api/products/[id]/route";
import { POST as replacePost } from "@/app/api/products/[id]/credentials/route";
import { POST as testPost } from "@/app/api/products/[id]/test/route";

function browser(
  path: string,
  body?: unknown,
  options: { method?: string; cookie?: string | null; origin?: string } = {},
): Request {
  const headers = new Headers({ Origin: options.origin ?? origin });
  const authCookie =
    options.cookie === null ? undefined : (options.cookie ?? cookie);
  if (authCookie) headers.set("Cookie", authCookie);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return new Request(`${origin}${path}`, {
    method: options.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function serve(
  test: TestContext,
  handler: ControlHandler,
): Promise<{
  endpoint: string;
  close: () => Promise<void>;
  count: () => number;
}> {
  let requests = 0;
  const server = createServer((incoming, outgoing) => {
    requests++;
    void (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of incoming) {
        const value: unknown = chunk;
        if (!(value instanceof Uint8Array)) throw new Error("Invalid body");
        chunks.push(value);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === "string") headers.set(name, value);
        else value?.forEach((entry) => headers.append(name, entry));
      }
      const response = await handler(
        new Request(`http://127.0.0.1${incoming.url}`, {
          method: incoming.method,
          headers,
          body: Buffer.concat(chunks),
        }),
      );
      outgoing.statusCode = response.status;
      response.headers.forEach((value, name) =>
        outgoing.setHeader(name, value),
      );
      outgoing.end(new Uint8Array(await response.arrayBuffer()));
    })().catch(() => {
      outgoing.statusCode = 500;
      outgoing.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  const close = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  test.onTestFinished(close);
  return {
    endpoint: `http://127.0.0.1:${address.port}/api/control`,
    close,
    count: () => requests,
  };
}

function credential(): { keyId: string; secret: string } {
  return {
    keyId: `test_${randomBytes(8).toString("hex")}`,
    secret: randomBytes(32).toString("hex"),
  };
}
function handlerFor(
  auth: { keyId: string; secret: string },
  rich = false,
): ControlHandler {
  return createControlHandler({
    product: {
      id: rich ? "product-a" : "product-b",
      name: rich ? "Product A" : "Product B",
    },
    auth,
    replayStore: createMemoryReplayStore(),
    users: {
      get: () => null,
      ...(rich ? { search: () => [], ban: () => {} } : {}),
    },
    ...(rich
      ? {
          actions: {
            summarize: {
              label: "Summarize",
              description: "Return a summary",
              risk: "safe" as const,
              run: () => ({ count: 0 }),
            },
          },
        }
      : {}),
  });
}

async function add(
  endpoint: string,
  auth = credential(),
  name = "Product",
): Promise<ProductWriteResult> {
  return registerProduct({
    name,
    endpoint,
    credentials: { mode: "existing", ...auth },
  });
}

beforeAll(async () => {
  initializeDatabase();
  const response = await setupPost(
    browser(
      "/api/setup",
      { setupToken, name: "Owner", email: "owner@example.com", password },
      { cookie: null },
    ),
  );
  expect(response.status).toBe(201);
  const login = await authPost(
    browser(
      "/api/auth/sign-in/email",
      { email: "owner@example.com", password },
      { cookie: null },
    ),
  );
  expect(login.status).toBe(200);
  const sessionCookie = login.headers
    .getSetCookie()
    .find((entry) => entry.includes("session_token="));
  expect(sessionCookie).toBeDefined();
  cookie = sessionCookie!.split(";")[0];
});
beforeEach(() => {
  getDatabase().delete(products).run();
  getDatabase().delete(authThrottle).run();
  getDatabase().update(session).set({ createdAt: new Date() }).run();
  allowPrivate = true;
});
afterAll(() => {
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
});

describe("encrypted product registry and real signed SDK HTTP connections", () => {
  it("registers and discovers two independent products with their exact advertised capabilities", async (test) => {
    const authA = credential();
    const authB = credential();
    const first = await serve(test, handlerFor(authA, true));
    const second = await serve(test, handlerFor(authB));
    const a = await add(first.endpoint, authA, "A");
    const b = await add(second.endpoint, authB, "B");
    expect(a).not.toHaveProperty("credentials");
    expect(a.product.status).toBe("unknown");
    const views = await Promise.all([
      testProductConnection(a.product.id),
      testProductConnection(b.product.id),
    ]);
    expect(views.map((view) => view.status)).toEqual(["online", "online"]);
    expect(views[0].capabilities?.operations).toContain("users.ban");
    expect(views[0].capabilities?.actions).toEqual([
      {
        id: "summarize",
        label: "Summarize",
        description: "Return a summary",
        risk: "safe",
      },
    ]);
    expect(views[1].capabilities?.operations).toEqual([
      "system.capabilities",
      "users.get",
    ]);
    expect(views[1].capabilities?.actions).toEqual([]);
    expect(views[0].lastConnectedAt).not.toBeNull();
    expect(JSON.stringify(listProducts())).not.toContain(authA.secret);
    expect(JSON.stringify(listProducts())).not.toContain("encryptedSecret");
    expect(first.count()).toBe(1);
    expect(second.count()).toBe(1);
  });

  it("encrypts accepted credentials, exposes generated credentials exactly once, and persists across restart", async (test) => {
    const fixture = await serve(test, handlerFor(credential()));
    const generatedResponse = await createPost(
      browser("/api/products", {
        name: "Generated",
        endpoint: fixture.endpoint,
        credentials: { mode: "generate" },
      }),
    );
    expect(generatedResponse.status).toBe(201);
    const generated = (await generatedResponse.json()) as ProductWriteResult;
    expect(generated.credentials?.secret).toHaveLength(43);
    expect(generated.credentials?.keyId).toBe(generated.product.keyId);
    const record = getDatabase().select().from(products).get()!;
    expect(decryptProductSecret(record, record.id, record.keyId)).toBe(
      generated.credentials?.secret,
    );
    expect(JSON.stringify(record)).not.toContain(generated.credentials!.secret);
    const listResponse = await listGet(browser("/api/products"));
    const detailResponse = await detailGet(
      browser(`/api/products/${record.id}`),
      context(record.id),
    );
    expect(await listResponse.text()).not.toContain(
      generated.credentials!.secret,
    );
    expect(await detailResponse.text()).not.toContain(
      generated.credentials!.secret,
    );
    expect(listResponse.headers.get("cache-control")).toBe("no-store");
    closeDatabase();
    delete (globalThis as typeof globalThis & { controlAuth?: unknown })
      .controlAuth;
    expect(
      readFileSync(databasePath).includes(
        Buffer.from(generated.credentials!.secret),
      ),
    ).toBe(false);
    initializeDatabase();
    expect(getProduct(record.id)?.keyId).toBe(generated.credentials?.keyId);
    expect(
      decryptProductSecret(
        getDatabase().select().from(products).get()!,
        record.id,
        record.keyId,
      ),
    ).toBe(generated.credentials?.secret);
  });

  it("rejects secret reuse across products, instance secrets, and secrets embedded in public fields", async (test) => {
    const fixture = await serve(test, handlerFor(credential()));
    const auth = credential();
    await add(fixture.endpoint, auth);
    await expect(
      add(fixture.endpoint, { ...auth, keyId: "different-key" }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_REUSED" });
    await expect(
      add(fixture.endpoint, { ...auth, secret: authSecret }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_REUSED" });
    const other = credential();
    await expect(
      add(fixture.endpoint, other, other.secret),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(getDatabase().select().from(products).all()).toHaveLength(1);
  });

  it("uses the SDK key ID schema and literal UTF-8 byte limits", () => {
    expect(
      credentialInputSchema.safeParse({
        mode: "existing",
        keyId: "bad key",
        secret: "s".repeat(32),
      }).success,
    ).toBe(false);
    expect(
      credentialInputSchema.safeParse({
        mode: "existing",
        keyId: "valid_key",
        secret: "é".repeat(16),
      }).success,
    ).toBe(true);
    expect(
      credentialInputSchema.safeParse({
        mode: "existing",
        keyId: "valid_key",
        secret: "é".repeat(513),
      }).success,
    ).toBe(false);
    expect(
      credentialInputSchema.safeParse({
        mode: "existing",
        keyId: "valid_key",
        secret: " ".repeat(40),
      }).success,
    ).toBe(false);
    expect(
      credentialInputSchema.safeParse({
        mode: "generate",
        secret: "must-not-accept",
      }).success,
    ).toBe(false);
  });

  it("preserves safe SDK authentication errors without leaking response metadata or credentials", async (test) => {
    const auth = credential();
    const fixture = await serve(test, handlerFor(auth));
    const registered = await add(fixture.endpoint);
    const product = await testProductConnection(registered.product.id);
    expect(product).toMatchObject({
      status: "degraded",
      lastErrorCode: "AUTHENTICATION_FAILED",
      capabilities: null,
      lastConnectedAt: null,
    });
    expect(JSON.stringify(product)).not.toContain(auth.secret);
  });

  it("rejects malformed and oversized responses without persisting their contents", async (test) => {
    for (const body of [
      JSON.stringify({
        stack: "private remote failure",
        secret: "private-token",
      }),
      "x".repeat(300_000),
    ]) {
      const fixture = await serve(
        test,
        async () =>
          new Response(body, {
            headers: { "content-type": "application/json" },
          }),
      );
      const registered = await add(fixture.endpoint);
      const product = await testProductConnection(registered.product.id);
      expect(product).toMatchObject({
        status: "degraded",
        lastErrorCode: "INVALID_RESPONSE",
        capabilities: null,
      });
      expect(JSON.stringify(product)).not.toContain("private remote failure");
      expect(
        getDatabase()
          .select()
          .from(products)
          .where(eq(products.id, product.id))
          .get()?.capabilitiesJson,
      ).toBeNull();
    }
  });

  it.for(["product", "auth", "encryption", "setup"] as const)(
    "rejects schema-valid capability metadata containing the %s secret",
    async (kind, test) => {
      const auth = {
        ...credential(),
        secret: `secret-line\n${randomBytes(32).toString("hex")}`,
      };
      const leaked = {
        product: auth.secret,
        auth: authSecret,
        encryption: encryptionKey,
        setup: setupToken,
      }[kind];
      const handler = createControlHandler({
        product: { id: "echoing", name: leaked },
        auth,
        replayStore: createMemoryReplayStore(),
      });
      const fixture = await serve(test, handler);
      const registered = await add(fixture.endpoint, auth);
      expect(await testProductConnection(registered.product.id)).toMatchObject({
        status: "degraded",
        capabilities: null,
        lastErrorCode: "INVALID_RESPONSE",
      });
      expect(
        JSON.stringify(getDatabase().select().from(products).all()),
      ).not.toContain(leaked);
    },
  );

  it("does not follow redirects or send signed credentials to a redirect target", async (test) => {
    const target = await serve(test, handlerFor(credential()));
    const source = await serve(test, async () =>
      Response.redirect(target.endpoint, 307),
    );
    const registered = await add(source.endpoint);
    expect(await testProductConnection(registered.product.id)).toMatchObject({
      status: "degraded",
      lastErrorCode: "REDIRECT_BLOCKED",
    });
    expect(target.count()).toBe(0);
  });

  it("bounds a stalled HTTP endpoint and records an honest offline timeout", async (test) => {
    const fixture = await serve(test, () => new Promise<Response>(() => {}));
    const registered = await add(fixture.endpoint);
    const started = performance.now();
    expect(await testProductConnection(registered.product.id)).toMatchObject({
      status: "offline",
      lastErrorCode: "REQUEST_TIMEOUT",
    });
    expect(performance.now() - started).toBeLessThan(6500);
    expect(fixture.count()).toBe(1);
  });

  it("retains last validated metadata when offline and keeps another product usable", async (test) => {
    const authA = credential();
    const authB = credential();
    const a = await serve(test, handlerFor(authA, true));
    const b = await serve(test, handlerFor(authB));
    const productA = await add(a.endpoint, authA, "A");
    const productB = await add(b.endpoint, authB, "B");
    const online = await testProductConnection(productB.product.id);
    await b.close();
    const [available, unavailable] = await Promise.all([
      testProductConnection(productA.product.id),
      testProductConnection(productB.product.id),
    ]);
    expect(available.status).toBe("online");
    expect(unavailable).toMatchObject({
      status: "offline",
      lastErrorCode: "PRODUCT_UNAVAILABLE",
      lastConnectedAt: online.lastConnectedAt,
      capabilities: online.capabilities,
    });
  });

  it("revalidates endpoint policy before sending and rejects unsafe registration", async (test) => {
    const auth = credential();
    const fixture = await serve(test, handlerFor(auth));
    const registered = await add(fixture.endpoint, auth);
    allowPrivate = false;
    expect(await testProductConnection(registered.product.id)).toMatchObject({
      status: "degraded",
      lastErrorCode: "INVALID_ENDPOINT",
    });
    expect(fixture.count()).toBe(0);
    for (const endpoint of [
      fixture.endpoint,
      "http://169.254.169.254/latest/meta-data",
      "https://user:password@example.com/control",
      "https://example.com/control#secret",
    ]) {
      expect(
        (
          await createPost(
            browser("/api/products", {
              name: "Unsafe",
              endpoint,
              credentials: { mode: "generate" },
            }),
          )
        ).status,
      ).toBe(400);
    }
  });

  it("requires owner access, same origin, fresh authentication, and typed confirmation", async (test) => {
    const fixture = await serve(test, handlerFor(credential()));
    const registered = await add(fixture.endpoint);
    const id = registered.product.id;
    const anonymous = { cookie: null };
    expect(
      (await listGet(browser("/api/products", undefined, anonymous))).status,
    ).toBe(401);
    expect(
      (await createPost(browser("/api/products", {}, anonymous))).status,
    ).toBe(401);
    expect(
      (
        await testPost(
          browser(`/api/products/${id}/test`, {}, anonymous),
          context(id),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await updateProduct(
          browser(
            `/api/products/${id}`,
            { enabled: false },
            { ...anonymous, method: "PATCH" },
          ),
          context(id),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await replacePost(
          browser(`/api/products/${id}/credentials`, {}, anonymous),
          context(id),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await deleteProduct(
          browser(
            `/api/products/${id}`,
            {},
            { ...anonymous, method: "DELETE" },
          ),
          context(id),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await testPost(
          browser(
            `/api/products/${id}/test`,
            {},
            { origin: "https://evil.example" },
          ),
          context(id),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await deleteProduct(
          browser(
            `/api/products/${id}`,
            { confirmation: "wrong" },
            { method: "DELETE" },
          ),
          context(id),
        )
      ).status,
    ).toBe(400);
    const owner = await getAuth().api.getSession({
      headers: new Headers({ Cookie: cookie }),
    });
    getDatabase()
      .update(session)
      .set({ createdAt: new Date(Date.now() - 360_000) })
      .where(eq(session.id, owner!.session.id))
      .run();
    const stale = await replacePost(
      browser(`/api/products/${id}/credentials`, {
        credentials: { mode: "generate" },
        confirmation: "Product",
      }),
      context(id),
    );
    expect(stale.status).toBe(403);
    expect(await stale.json()).toEqual({
      error: "RECENT_AUTHENTICATION_REQUIRED",
    });
    expect(
      (
        await createPost(
          browser("/api/products", {
            name: "New",
            endpoint: fixture.endpoint,
            credentials: { mode: "generate" },
          }),
        )
      ).status,
    ).toBe(403);
  });

  it("disables further connections and re-enables only as unknown until explicitly tested", async (test) => {
    const auth = credential();
    const fixture = await serve(test, handlerFor(auth));
    const registered = await add(fixture.endpoint, auth);
    await testProductConnection(registered.product.id);
    expect(setProductEnabled(registered.product.id, false)).toMatchObject({
      enabled: false,
      status: "unknown",
    });
    await expect(
      testProductConnection(registered.product.id),
    ).rejects.toMatchObject({ code: "PRODUCT_DISABLED" });
    expect(fixture.count()).toBe(1);
    expect(setProductEnabled(registered.product.id, true).status).toBe(
      "unknown",
    );
    expect((await testProductConnection(registered.product.id)).status).toBe(
      "online",
    );
  });

  it("replaces credentials without retrieving the old secret and invalidates old capabilities", async (test) => {
    const first = credential();
    let handler = handlerFor(first);
    const fixture = await serve(test, (request) => handler(request));
    const registered = await add(fixture.endpoint, first);
    await testProductConnection(registered.product.id);
    const replacement = replaceProductCredentials(
      registered.product.id,
      { mode: "generate" },
      "Product",
    );
    expect(replacement.product).toMatchObject({
      status: "unknown",
      capabilities: null,
      lastConnectedAt: null,
      lastTestedAt: null,
    });
    expect(replacement.credentials?.secret).not.toBe(first.secret);
    expect(JSON.stringify(replacement)).not.toContain(first.secret);
    handler = handlerFor(replacement.credentials!);
    expect((await testProductConnection(registered.product.id)).status).toBe(
      "online",
    );
    expect(JSON.stringify(getProduct(registered.product.id))).not.toContain(
      replacement.credentials!.secret,
    );
  });

  for (const action of ["disable", "remove", "replace"] as const)
    it(`prevents an in-flight result from restoring a product after ${action}`, async (test) => {
      const auth = credential();
      let begin: (() => void) | undefined;
      let finish: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        begin = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const realHandler = handlerFor(auth);
      const fixture = await serve(test, async (request) => {
        begin?.();
        await gate;
        return realHandler(request);
      });
      const registered = await add(fixture.endpoint, auth);
      const pending = testProductConnection(registered.product.id);
      const rejected = expect(pending).rejects.toMatchObject({
        code: "PRODUCT_CHANGED",
      });
      await started;
      await expect(
        testProductConnection(registered.product.id),
      ).rejects.toMatchObject({ code: "PRODUCT_BUSY" });
      if (action === "disable") setProductEnabled(registered.product.id, false);
      else if (action === "remove")
        removeProduct(registered.product.id, "Product");
      else
        replaceProductCredentials(
          registered.product.id,
          { mode: "generate" },
          "Product",
        );
      finish?.();
      await rejected;
      if (action === "remove") {
        expect(getProduct(registered.product.id)).toBeNull();
        await expect(
          testProductConnection(registered.product.id),
        ).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
      } else
        expect(getProduct(registered.product.id)).toMatchObject({
          status: "unknown",
          capabilities: null,
          lastTestedAt: null,
        });
      expect(fixture.count()).toBe(1);
    });

  it("durably rate limits connection testing without sending additional requests", async (test) => {
    const fixture = await serve(test, handlerFor(credential()));
    const registered = await add(fixture.endpoint);
    getDatabase()
      .insert(authThrottle)
      .values({ key: "product-test", count: 30, windowStartedAt: Date.now() })
      .run();
    const response = await testPost(
      browser(`/api/products/${registered.product.id}/test`, {}),
      context(registered.product.id),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(fixture.count()).toBe(0);
  });

  it("limits concurrent products without queueing additional privileged requests", async (test) => {
    let release: (() => void) | undefined;
    let ready: (() => void) | undefined;
    let requests = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const fixture = await serve(test, async () => {
      if (++requests === 4) ready?.();
      await gate;
      return Response.json({});
    });
    const registered = await Promise.all(
      Array.from({ length: 5 }, () => add(fixture.endpoint)),
    );
    const pending = registered
      .slice(0, 4)
      .map((result) => testProductConnection(result.product.id));
    await started;
    await expect(
      testProductConnection(registered[4].product.id),
    ).rejects.toMatchObject({ code: "CONNECTION_LIMIT", status: 429 });
    expect(fixture.count()).toBe(4);
    release?.();
    await Promise.all(pending);
  });

  it("revalidates persisted capability metadata before presenting it", async (test) => {
    const fixture = await serve(test, handlerFor(credential()));
    const registered = await add(fixture.endpoint);
    getDatabase()
      .update(products)
      .set({
        capabilitiesJson: '{"invalid":"remote payload"}',
        lastConnectionStatus: "online",
      })
      .where(eq(products.id, registered.product.id))
      .run();
    expect(getProduct(registered.product.id)).toMatchObject({
      status: "degraded",
      capabilities: null,
      lastErrorCode: "INVALID_RESPONSE",
    });
    expect(JSON.stringify(listProducts())).not.toContain("remote payload");
  });

  it("rejects tampered stored credentials safely before making an outbound request", async (test) => {
    const fixture = await serve(test, handlerFor(credential()));
    const registered = await add(fixture.endpoint);
    getDatabase()
      .update(products)
      .set({ secretAuthTag: randomBytes(16).toString("base64") })
      .where(eq(products.id, registered.product.id))
      .run();
    expect(await testProductConnection(registered.product.id)).toMatchObject({
      status: "degraded",
      lastErrorCode: "CREDENTIAL_UNAVAILABLE",
    });
    expect(fixture.count()).toBe(0);
  });
});
