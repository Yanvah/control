import {
  auditedRequest,
  beginAudit,
  describeAudit,
  auditOutcome,
} from "@/lib/audit/context";
import type { AuditAction } from "@/lib/audit/models";
import { z } from "zod";
import { getAuth, getOwnerSession, requireApiOwner } from "@/lib/auth/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  jsonResponse,
  readJson,
  requestErrorResponse,
  requireSameOrigin,
  requireSameOriginRead,
} from "@/lib/security/request";

export const runtime = "nodejs";
const allowedGetPaths = new Set([
  "/get-session",
  "/passkey/generate-register-options",
  "/passkey/generate-authenticate-options",
]);
const allowedPostPaths = new Set([
  "/sign-in/email",
  "/sign-out",
  "/passkey/verify-registration",
  "/passkey/verify-authentication",
]);

async function browserResponse(response: Response): Promise<Response> {
  // Better Auth's internal session model includes the bearer token. The browser
  // only needs the HTTP-only cookie and display fields, never that JSON token.
  if (!response.headers.get("content-type")?.includes("application/json"))
    return response;
  const value: unknown = await response.json();
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const data = value as Record<string, unknown>;
    delete data.token;
    if (
      data.session !== null &&
      typeof data.session === "object" &&
      !Array.isArray(data.session)
    ) {
      delete (data.session as Record<string, unknown>).token;
    }
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), {
    status: response.status,
    headers,
  });
}

async function handle(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.slice("/api/auth".length);
  if (
    !(request.method === "GET" ? allowedGetPaths : allowedPostPaths).has(path)
  ) {
    return jsonResponse({ error: "NOT_FOUND" }, 404);
  }
  try {
    let forwardedRequest = request;
    if (request.method === "POST") {
      requireSameOrigin(request);
      const body = await readJson(
        request,
        z.record(z.string(), z.unknown()),
        65_536,
      );
      forwardedRequest = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(body),
      });
    } else if (path.startsWith("/passkey/")) {
      requireSameOriginRead(request);
    }
    if (
      path === "/passkey/generate-register-options" ||
      path === "/passkey/verify-registration"
    ) {
      await requireApiOwner(request, true);
    }
    if (
      path === "/sign-in/email" ||
      path === "/passkey/verify-authentication"
    ) {
      enforceRateLimit("login", 20);
    } else if (path !== "/get-session") {
      enforceRateLimit("auth", 60);
    }
    const owner = await getOwnerSession(request.headers);
    if (owner) describeAudit({ actorId: owner.user.id });
    if (path !== "/get-session") beginAudit();
    const response = await getAuth().handler(forwardedRequest);
    if (
      response.ok &&
      (path === "/sign-in/email" || path === "/passkey/verify-authentication")
    ) {
      const value: unknown = await response.clone().json();
      const identity = z
        .object({ user: z.object({ id: z.string() }) })
        .safeParse(value);
      if (identity.success) describeAudit({ actorId: identity.data.user.id });
    }
    if (!response.ok) auditOutcome("failed", "AUTHENTICATION_FAILED");
    return browserResponse(response);
  } catch (error) {
    return requestErrorResponse(error);
  }
}

function actionFor(request: Request): AuditAction {
  const path = new URL(request.url).pathname.slice("/api/auth".length);
  switch (path) {
    case "/sign-in/email":
      return "auth.login.password";
    case "/passkey/verify-authentication":
      return "auth.login.passkey";
    case "/passkey/verify-registration":
      return "auth.passkey.register";
    case "/passkey/generate-register-options":
    case "/passkey/generate-authenticate-options":
      return "auth.passkey.challenge";
    case "/sign-out":
      return "auth.signout";
    default:
      return "auth.rejected";
  }
}
export async function GET(request: Request): Promise<Response> {
  if (new URL(request.url).pathname === "/api/auth/get-session")
    return handle(request);
  return auditedRequest(actionFor(request), () => handle(request));
}
export async function POST(request: Request): Promise<Response> {
  return auditedRequest(actionFor(request), () => handle(request));
}
