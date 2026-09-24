import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { startAudit, finishAudit, type AuditRecord } from "./store";
import { logAuditEvent, logSecurityEvent } from "./logging";
import type {
  AuditAction,
  AuditDetails,
  AuditMetadata,
  AuditOutcome,
} from "./models";

type Context = {
  requestId: string;
  details: AuditDetails;
  record?: AuditRecord;
  outcome?: Exclude<AuditOutcome, "requested">;
  code?: unknown;
  finished?: boolean;
};
const state = globalThis as typeof globalThis & {
  controlAuditContext?: AsyncLocalStorage<Context>;
};
const storage = (state.controlAuditContext ??=
  new AsyncLocalStorage<Context>());

export function describeAudit(details: Partial<AuditDetails>): void {
  const context = storage.getStore();
  if (context)
    context.details = {
      ...context.details,
      ...details,
      metadata: { ...context.details.metadata, ...details.metadata },
    };
}
export function beginAudit(details?: AuditDetails): AuditRecord {
  const context = storage.getStore();
  if (!context) {
    if (!details) throw new Error("Missing audit context");
    return startAudit(details);
  }
  if (details) describeAudit(details);
  context.record ??= startAudit(context.details, context.requestId);
  return context.record;
}
export function auditOutcome(
  outcome: Exclude<AuditOutcome, "requested">,
  code?: unknown,
  metadata?: AuditMetadata,
): void {
  const context = storage.getStore();
  if (context) {
    context.outcome = outcome;
    context.code = code;
    if (metadata) describeAudit({ metadata });
  }
}
export function completeAudit(record: AuditRecord): void {
  logAuditEvent(record);
  const context = storage.getStore();
  if (context?.record?.requestId === record.requestId) context.finished = true;
}

export async function auditedRequest(
  action: AuditAction,
  work: () => Promise<Response>,
): Promise<Response> {
  // Never accept a browser-supplied correlation ID as a trusted identifier.
  const context: Context = { requestId: randomUUID(), details: { action } };
  return storage.run(context, async () => {
    try {
      const response = await work();
      if (!context.finished) {
        const record = beginAudit();
        const outcome =
          context.outcome ??
          (response.ok
            ? "succeeded"
            : response.status >= 500
              ? "unknown"
              : "failed");
        completeAudit(
          finishAudit(
            record,
            outcome,
            context.code ?? (response.ok ? null : "REQUEST_FAILED"),
            { ...context.details.metadata, status: response.status },
            context.details.actorId,
            context.details.productId,
          ),
        );
      }
      response.headers.set("X-Request-ID", context.requestId);
      return response;
    } catch {
      // A broken audit store must never allow an unaudited mutation or emit raw
      // storage diagnostics. An already dispatched action may have succeeded.
      logSecurityEvent({
        requestId: context.requestId,
        action,
        outcome: "unknown",
        code: "AUDIT_UNAVAILABLE",
      });
      return Response.json(
        { error: "AUDIT_UNAVAILABLE" },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "X-Request-ID": context.requestId,
          },
        },
      );
    }
  });
}
