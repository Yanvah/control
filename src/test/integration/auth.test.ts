import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

mkdirSync(join(process.cwd(), ".test-data"), { recursive: true });
const testDirectory = mkdtempSync(join(process.cwd(), ".test-data", "auth-"));
const origin = "http://localhost:3000";
const setupToken = randomBytes(32).toString("hex");
const password = randomBytes(32).toString("base64");
const authSecret = randomBytes(32).toString("base64");
const encryptionKey = randomBytes(32).toString("base64");
let configuredSetupToken: string | undefined = setupToken;

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    NODE_ENV: "test",
    CONTROL_URL: origin,
    CONTROL_AUTH_SECRET: authSecret,
    CONTROL_ENCRYPTION_KEY: encryptionKey,
    CONTROL_SETUP_TOKEN: configuredSetupToken,
    DATABASE_PATH: join(testDirectory, "control.db"),
    CONTROL_ALLOW_HTTP_ENDPOINTS: false,
    CONTROL_ALLOW_PRIVATE_ENDPOINTS: false,
  }),
}));

import {
  closeDatabase,
  getDatabase,
  getSqlite,
  initializeDatabase,
} from "@/db/client";
import {
  account,
  authThrottle,
  instanceSettings,
  session,
  user,
} from "@/db/schema";
import { POST as setupPost } from "@/app/api/setup/route";
import {
  GET as authGet,
  POST as authPost,
} from "@/app/api/auth/[...all]/route";
import { GET as sessionsGet } from "@/app/api/sessions/route";
import { POST as revokeSessionPost } from "@/app/api/sessions/revoke/route";
import { POST as revokePasskeyPost } from "@/app/api/passkeys/revoke/route";
import {
  assertSetupConfiguration,
  claimInstance,
  isSetupComplete,
} from "@/lib/auth/setup";
import { getAuth } from "@/lib/auth/server";

function request(
  path: string,
  body?: unknown,
  cookie?: string,
  requestOrigin: string | null = origin,
): Request {
  const headers = new Headers();
  if (requestOrigin) headers.set("Origin", requestOrigin);
  if (cookie) headers.set("Cookie", cookie);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return new Request(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function ownerInput(): {
  setupToken: string;
  name: string;
  email: string;
  password: string;
} {
  return { setupToken, name: "Owner", email: "OWNER@example.com", password };
}
function cookieFrom(response: Response): string {
  const value = response.headers
    .getSetCookie()
    .find((cookie) => cookie.includes("session_token="));
  expect(value).toBeDefined();
  return value!.split(";")[0];
}
async function login(): Promise<{ response: Response; cookie: string }> {
  const response = await authPost(
    request("/api/auth/sign-in/email", {
      email: "owner@example.com",
      password,
    }),
  );
  expect(response.status).toBe(200);
  return { response, cookie: cookieFrom(response) };
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  initializeDatabase();
});
beforeEach(() => {
  vi.setSystemTime(Date.now() + 61_000);
});
afterAll(() => {
  vi.useRealTimers();
  closeDatabase();
  rmSync(testDirectory, { recursive: true, force: true });
});

describe(
  "secure first-owner setup and real Better Auth integration",
  { concurrent: false },
  () => {
    it("starts unclaimed and denies missing tokens, wrong tokens, and cross-origin claims", async () => {
      expect(isSetupComplete()).toBe(false);
      expect(() => assertSetupConfiguration()).not.toThrow();
      expect(
        (
          await setupPost(
            request("/api/setup", { ...ownerInput(), setupToken: undefined }),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await setupPost(
            request("/api/setup", { ...ownerInput(), setupToken: "wrong" }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await setupPost(
            request(
              "/api/setup",
              ownerInput(),
              undefined,
              "https://attacker.example",
            ),
          )
        ).status,
      ).toBe(403);
      expect(
        (await setupPost(request("/api/setup", ownerInput(), undefined, null)))
          .status,
      ).toBe(403);
      expect(getDatabase().select().from(user).all()).toHaveLength(0);
    });

    it("fails startup without a setup token or with an owner lacking a completed setup transaction", () => {
      configuredSetupToken = undefined;
      expect(() => assertSetupConfiguration()).toThrow(
        "CONTROL_SETUP_TOKEN is required",
      );
      configuredSetupToken = setupToken;
      getDatabase()
        .insert(user)
        .values({
          id: "orphan",
          name: "Orphan",
          email: "orphan@example.com",
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();
      expect(() => assertSetupConfiguration()).toThrow(
        "ownership state is inconsistent",
      );
      getDatabase().delete(user).where(eq(user.id, "orphan")).run();
    });

    it("public registration and unrecognized Better Auth endpoints remain closed", async () => {
      expect(
        (
          await authPost(
            request("/api/auth/sign-up/email", {
              name: "Visitor",
              email: "visitor@example.com",
              password,
            }),
          )
        ).status,
      ).toBe(404);
      expect(
        (await authPost(request("/api/auth/delete-user", {}))).status,
      ).toBe(404);
    });

    it("atomically admits exactly one of two simultaneous valid claims", async () => {
      const responses = await Promise.all([
        setupPost(request("/api/setup", ownerInput())),
        setupPost(request("/api/setup", ownerInput())),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        201, 409,
      ]);
      expect(isSetupComplete()).toBe(true);
      expect(getDatabase().select().from(user).all()).toHaveLength(1);
      const credentials = getDatabase().select().from(account).all();
      expect(credentials).toHaveLength(1);
      expect(credentials[0].password).not.toContain(password);
      expect(credentials[0].password?.length).toBeGreaterThan(100);
      expect(getDatabase().select().from(user).get()?.email).toBe(
        "owner@example.com",
      );
    });

    it("cannot reopen setup by deleting or editing its marker, deleting the owner, or inserting another user", async () => {
      expect(
        (await setupPost(request("/api/setup", ownerInput()))).status,
      ).toBe(409);
      expect(() => getDatabase().delete(instanceSettings).run()).toThrow();
      expect(() =>
        getDatabase()
          .update(instanceSettings)
          .set({ setupCompletedAt: new Date() })
          .run(),
      ).toThrow();
      expect(() => getDatabase().delete(user).run()).toThrow();
      expect(() =>
        getDatabase()
          .insert(user)
          .values({
            id: "second",
            name: "Second",
            email: "second@example.com",
            emailVerified: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .run(),
      ).toThrow();
    });

    it("denies anonymous session/passkey mutations and cross-origin login", async () => {
      expect((await sessionsGet(request("/api/sessions"))).status).toBe(401);
      expect(
        (
          await revokeSessionPost(
            request("/api/sessions/revoke", { sessionId: "missing" }),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await revokePasskeyPost(
            request("/api/passkeys/revoke", { passkeyId: "missing" }),
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await authPost(
            request(
              "/api/auth/sign-in/email",
              { email: "owner@example.com", password },
              undefined,
              "https://attacker.example",
            ),
          )
        ).status,
      ).toBe(403);
    });

    it("uses real password verification, HTTP-only cookies, and token-free session JSON", async () => {
      const badLogin = await authPost(
        request("/api/auth/sign-in/email", {
          email: "owner@example.com",
          password: "wrong-password",
        }),
      );
      expect(badLogin.status).toBe(401);
      const { response, cookie } = await login();
      const setCookie = response.headers.getSetCookie().join(";");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie.toLowerCase()).toContain("samesite=lax");
      expect(await response.json()).not.toHaveProperty("token");
      const current = await authGet(
        request("/api/auth/get-session", undefined, cookie),
      );
      const data = await current.json();
      expect(data.user.email).toBe("owner@example.com");
      expect(data.session).not.toHaveProperty("token");
    });

    it("sets Secure, HTTP-only, SameSite cookies for an HTTPS instance with no token in the response body", () => {
      const result = spawnSync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `
      const { POST } = await import('./src/app/api/auth/[...all]/route.ts');
      const response = await POST(new Request('https://control.example.test/api/auth/sign-in/email', {
        method: 'POST', headers: { Origin: 'https://control.example.test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'owner@example.com', password: process.env.TEST_OWNER_PASSWORD })
      }));
      const cookie = response.headers.getSetCookie().find(value => value.includes('session_token=')) ?? '';
      const body = await response.json();
      process.stdout.write(JSON.stringify({ status: response.status, secure: /; Secure(?:;|$)/i.test(cookie),
        httpOnly: /; HttpOnly(?:;|$)/i.test(cookie), sameSite: /; SameSite=Lax(?:;|$)/i.test(cookie),
        prefix: cookie.startsWith('__Secure-'), exposesToken: Object.hasOwn(body, 'token') }));
    `,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            NODE_ENV: "test",
            CONTROL_URL: "https://control.example.test",
            CONTROL_AUTH_SECRET: authSecret,
            CONTROL_ENCRYPTION_KEY: encryptionKey,
            CONTROL_SETUP_TOKEN: undefined,
            DATABASE_PATH: join(testDirectory, "control.db"),
            TEST_OWNER_PASSWORD: password,
          },
          timeout: 15_000,
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "")).toEqual(
        {
          status: 200,
          secure: true,
          httpOnly: true,
          sameSite: true,
          prefix: true,
          exposesToken: false,
        },
      );
    });

    it("lists safe session metadata, rejects stale authentication, and immediately revokes another session", async () => {
      const first = await login();
      const second = await login();
      const listResponse = await sessionsGet(
        request("/api/sessions", undefined, first.cookie),
      );
      const list = await listResponse.json();
      expect(list.sessions.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(list)).not.toContain('"token"');
      const ownerSession = await getAuth().api.getSession({
        headers: new Headers({ Cookie: first.cookie }),
      });
      const targetSession = await getAuth().api.getSession({
        headers: new Headers({ Cookie: second.cookie }),
      });
      expect(ownerSession).not.toBeNull();
      expect(targetSession).not.toBeNull();
      const currentId = ownerSession!.session.id;
      const targetId = targetSession!.session.id;
      getDatabase()
        .update(session)
        .set({ createdAt: new Date(Date.now() - 6 * 60_000) })
        .where(eq(session.id, currentId))
        .run();
      expect(
        (
          await revokeSessionPost(
            request(
              "/api/sessions/revoke",
              { sessionId: targetId },
              first.cookie,
            ),
          )
        ).status,
      ).toBe(403);
      getDatabase()
        .update(session)
        .set({ createdAt: new Date() })
        .where(eq(session.id, currentId))
        .run();
      expect(
        (
          await revokeSessionPost(
            request(
              "/api/sessions/revoke",
              { sessionId: targetId },
              first.cookie,
              "https://attacker.example",
            ),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await revokeSessionPost(
            request(
              "/api/sessions/revoke",
              { sessionId: targetId },
              first.cookie,
            ),
          )
        ).status,
      ).toBe(200);
      expect(
        (await sessionsGet(request("/api/sessions", undefined, second.cookie)))
          .status,
      ).toBe(401);
      expect(
        (
          await revokeSessionPost(
            request(
              "/api/sessions/revoke",
              { sessionId: currentId },
              first.cookie,
            ),
          )
        ).status,
      ).toBe(400);
      const logout = await authPost(
        request("/api/auth/sign-out", {}, first.cookie),
      );
      expect(logout.status).toBe(200);
      expect(
        (await sessionsGet(request("/api/sessions", undefined, first.cookie)))
          .status,
      ).toBe(401);
    });

    it("requires authenticated fresh ownership for passkey enrollment", async () => {
      const anonymous = await authGet(
        request("/api/auth/passkey/generate-register-options"),
      );
      expect(anonymous.status).toBe(401);
      const owner = await login();
      const options = await authGet(
        request(
          "/api/auth/passkey/generate-register-options",
          undefined,
          owner.cookie,
        ),
      );
      expect(options.status).toBe(200);
      const data = await options.json();
      expect(data.rp.id).toBe("localhost");
      expect(data.authenticatorSelection.userVerification).toBe("required");
      expect(data.authenticatorSelection.residentKey).toBe("required");
    });

    it("rate limits repeated login attempts durably without trusting forged IP headers", async () => {
      getDatabase()
        .delete(authThrottle)
        .where(eq(authThrottle.key, "login"))
        .run();
      for (let attempt = 0; attempt < 20; attempt++) {
        const failedRequest = request("/api/auth/sign-in/email", {
          email: "owner@example.com",
          password: "wrong-password",
        });
        failedRequest.headers.set("x-forwarded-for", `192.0.2.${attempt + 1}`);
        expect([401, 429]).toContain((await authPost(failedRequest)).status);
      }
      const blocked = await authPost(
        request("/api/auth/sign-in/email", {
          email: "owner@example.com",
          password,
        }),
      );
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBe("60");
      expect(await blocked.json()).toEqual({ error: "TOO_MANY_ATTEMPTS" });
    });

    it("persists ownership and migrations through a database close/reopen", async () => {
      const ownerId = getDatabase()
        .select()
        .from(instanceSettings)
        .get()?.ownerId;
      closeDatabase();
      initializeDatabase();
      expect(isSetupComplete()).toBe(true);
      expect(getDatabase().select().from(instanceSettings).get()?.ownerId).toBe(
        ownerId,
      );
      expect(getSqlite().pragma("foreign_keys", { simple: true })).toBe(1);
      expect(getSqlite().pragma("journal_mode", { simple: true })).toBe("wal");
      await expect(claimInstance(ownerInput())).rejects.toMatchObject({
        status: 409,
      });
      expect(
        getDatabase()
          .select()
          .from(account)
          .where(
            and(
              eq(account.providerId, "credential"),
              eq(account.userId, ownerId!),
            ),
          )
          .get(),
      ).toBeDefined();
    });
  },
);
