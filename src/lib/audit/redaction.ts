import "server-only";
import { createHmac } from "node:crypto";
import { getEnv } from "@/lib/env";
import type { AuditMetadata } from "./models";

const safeCodes = new Set([
  "ATTEMPT_CONFLICT",
  "ATTEMPT_NOT_FOUND",
  "AUTHENTICATION_FAILED",
  "CAPABILITIES_CHANGED",
  "CONFIRMATION_REQUIRED",
  "CONNECTION_FAILED",
  "CONNECTION_LIMIT",
  "CREDENTIAL_REUSED",
  "CREDENTIAL_UNAVAILABLE",
  "ENDPOINT_UNAVAILABLE",
  "INVALID_ENDPOINT",
  "INVALID_INPUT",
  "INVALID_ORIGIN",
  "INVALID_REQUEST",
  "INVALID_RESPONSE",
  "INVALID_SETUP_TOKEN",
  "JSON_REQUIRED",
  "NOT_FOUND",
  "OPERATION_UNSUPPORTED",
  "PASSKEY_NOT_FOUND",
  "PROCESS_INTERRUPTED",
  "PRODUCT_BUSY",
  "PRODUCT_CHANGED",
  "PRODUCT_DISABLED",
  "PRODUCT_NOT_FOUND",
  "PRODUCT_UNAVAILABLE",
  "RECENT_AUTHENTICATION_REQUIRED",
  "REDIRECT_BLOCKED",
  "REQUEST_ABORTED",
  "REQUEST_EXPIRED",
  "REQUEST_FAILED",
  "REQUEST_TIMEOUT",
  "REQUEST_TOO_LARGE",
  "SEARCH_REPLACED",
  "SESSION_NOT_FOUND",
  "SETUP_CLOSED",
  "SETUP_UNAVAILABLE",
  "TOO_MANY_ATTEMPTS",
  "TOO_MANY_REQUESTS",
  "UNAUTHORIZED",
  "UNSAFE_ENDPOINT",
  "USER_NOT_FOUND",
  "USER_ALREADY_EXISTS",
  "USE_SIGN_OUT",
  "AUDIT_UNAVAILABLE",
  "AUDIT_INTEGRITY_FAILED",
]);

export function safeAuditCode(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && safeCodes.has(value)
    ? value
    : "REQUEST_FAILED";
}

export function safeAuditId(value: unknown): string | null {
  // Only instance-generated UUIDs are stored verbatim. Remote IDs, including
  // session identifiers, use a keyed reference rather than arbitrary text.
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : null;
}

export function targetReference(value: string): string {
  return createHmac(
    "sha256",
    Buffer.from(getEnv().CONTROL_ENCRYPTION_KEY, "base64"),
  )
    .update("yanvah-control-audit-target-v1\0")
    .update(value)
    .digest("hex");
}

export function redactAuditMetadata(value: unknown): AuditMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const output: AuditMetadata = {};
  if (
    typeof input.status === "number" &&
    Number.isInteger(input.status) &&
    input.status >= 100 &&
    input.status <= 599
  )
    output.status = input.status;
  for (const key of ["enabled", "duplicate", "imported"] as const) {
    if (typeof input[key] === "boolean") output[key] = input[key];
  }
  if (
    input.credentialMode === "generate" ||
    input.credentialMode === "existing"
  )
    output.credentialMode = input.credentialMode;
  const sdkRequestId = safeAuditId(input.sdkRequestId);
  if (sdkRequestId) output.sdkRequestId = sdkRequestId;
  return output;
}
