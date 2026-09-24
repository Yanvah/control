import "server-only";
import { auditActions, type AuditOutcome } from "./models";
import { redactAuditMetadata, safeAuditCode, safeAuditId } from "./redaction";
import type { AuditRecord } from "./store";

export function logAuditEvent(event: AuditRecord): void {
  logSecurityEvent({
    requestId: event.requestId,
    action: event.action,
    outcome: event.eventType,
    code: event.safeCode,
    durationMs: event.durationMs,
    metadata: JSON.parse(event.metadataJson),
  });
}

// Reconstruct an allowlisted record; never serialize an Error, request, headers,
// route URL, response, or arbitrary nested metadata into the application log.
export function logSecurityEvent(input: {
  requestId?: string;
  action?: string;
  outcome: AuditOutcome;
  code?: unknown;
  durationMs?: number | null;
  metadata?: unknown;
}): void {
  console.info(
    JSON.stringify({
      time: new Date().toISOString(),
      level:
        input.outcome === "failed" || input.outcome === "unknown"
          ? "warn"
          : "info",
      event: "control.security",
      requestId: safeAuditId(input.requestId),
      action:
        auditActions.find((action) => action === input.action) ??
        "auth.rejected",
      outcome: ["requested", "succeeded", "failed", "unknown"].includes(
        input.outcome,
      )
        ? input.outcome
        : "unknown",
      code: safeAuditCode(input.code),
      durationMs:
        typeof input.durationMs === "number" &&
        Number.isSafeInteger(input.durationMs) &&
        input.durationMs >= 0
          ? input.durationMs
          : null,
      metadata: redactAuditMetadata(input.metadata),
    }),
  );
}
