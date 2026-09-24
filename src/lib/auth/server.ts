import "server-only";
import { describeAudit } from "@/lib/audit/context";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import * as schema from "@/db/schema";
import { getEnv } from "@/lib/env";
import { RequestError } from "@/lib/security/request";

export const RECENT_AUTH_SECONDS = 5 * 60;

function createAuth() {
  const env = getEnv();
  const origin = new URL(env.CONTROL_URL).origin;
  return betterAuth({
    appName: "Yanvah Control",
    baseURL: origin,
    secret: env.CONTROL_AUTH_SECRET,
    trustedOrigins: [origin],
    database: drizzleAdapter(getDatabase(), { provider: "sqlite", schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
    },
    session: {
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      freshAge: RECENT_AUTH_SECONDS,
      cookieCache: { enabled: false },
    },
    advanced: {
      cookiePrefix: "yanvah-control",
      useSecureCookies: origin.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      // The boundary enforces a database-backed instance-wide rate limit.
      // Do not trust client-supplied proxy headers for session attribution.
      ipAddress: { ipAddressHeaders: [] },
    },
    rateLimit: { enabled: true },
    telemetry: { enabled: false },
    logger: { disabled: true },
    plugins: [
      passkey({
        rpID: new URL(origin).hostname,
        rpName: "Yanvah Control",
        origin,
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        registration: {
          requireSession: true,
          afterVerification: async ({ verification }) => {
            if (!verification.registrationInfo?.userVerified)
              throw new APIError("BAD_REQUEST", {
                message: "User verification is required.",
              });
          },
        },
        authentication: {
          afterVerification: async ({ verification }) => {
            if (!verification.authenticationInfo.userVerified)
              throw new APIError("UNAUTHORIZED", {
                message: "User verification is required.",
              });
          },
        },
      }),
    ],
  });
}

type ControlAuth = ReturnType<typeof createAuth>;
const globalAuth = globalThis as typeof globalThis & {
  controlAuth?: ControlAuth;
};

export function getAuth(): ControlAuth {
  globalAuth.controlAuth ??= createAuth();
  return globalAuth.controlAuth;
}

export type OwnerSession = ControlAuth["$Infer"]["Session"];

export async function getOwnerSession(
  requestHeaders: Headers,
): Promise<OwnerSession | null> {
  const authSession = await getAuth().api.getSession({
    headers: requestHeaders,
    query: { disableCookieCache: true },
  });
  if (!authSession) return null;
  const owner = getDatabase()
    .select({ ownerId: schema.instanceSettings.ownerId })
    .from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 1))
    .get();
  return owner?.ownerId === authSession.user.id ? authSession : null;
}

export async function requireOwner(): Promise<OwnerSession> {
  const [{ headers }, { redirect }] = await Promise.all([
    import("next/headers"),
    import("next/navigation"),
  ]);
  const authSession = await getOwnerSession(await headers());
  if (!authSession) return redirect("/login");
  return authSession;
}

export async function requireApiOwner(
  request: Request,
  recent = false,
): Promise<OwnerSession> {
  const authSession = await getOwnerSession(request.headers);
  if (!authSession) throw new RequestError(401, "UNAUTHORIZED");
  describeAudit({ actorId: authSession.user.id });
  if (
    recent &&
    Date.now() - authSession.session.createdAt.getTime() >
      RECENT_AUTH_SECONDS * 1000
  ) {
    throw new RequestError(403, "RECENT_AUTHENTICATION_REQUIRED");
  }
  return authSession;
}
