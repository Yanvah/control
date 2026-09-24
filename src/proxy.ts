import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { securityHeaders } from "@/lib/security/headers";

export function proxy(request: NextRequest): NextResponse {
  const env = getEnv();
  const nonce = randomBytes(24).toString("base64");
  const headers = securityHeaders(
    nonce,
    env.NODE_ENV === "development",
    env.CONTROL_URL.startsWith("https:"),
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(
    "Content-Security-Policy",
    headers["Content-Security-Policy"],
  );
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [key, value] of Object.entries(headers))
    response.headers.set(key, value);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
