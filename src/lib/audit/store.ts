import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { asc, desc, eq, and, ne, gt, sql } from "drizzle-orm";
import { getDatabase, getSqlite } from "@/db/client";
import { auditEvents, operationEvents } from "@/db/schema";
import { getEnv } from "@/lib/env";
import {
  auditActions,
  type AuditDetails,
  type AuditMetadata,
  type AuditOutcome,
} from "./models";
import {
  redactAuditMetadata,
  safeAuditCode,
  safeAuditId,
  targetReference,
} from "./redaction";
import { logAuditEvent } from "./logging";

export type AuditRecord = typeof auditEvents.$inferSelect;
const genesis = "0".repeat(64);
type Unsigned = Omit<AuditRecord, "integrityHash">;
function digest(event: Unsigned): string {
  return createHmac(
    "sha256",
    Buffer.from(getEnv().CONTROL_ENCRYPTION_KEY, "base64"),
  )
    .update("yanvah-control-audit-chain-v1\0")
    .update(
      JSON.stringify([
        event.sequence,
        event.id,
        event.requestId,
        event.attemptId,
        event.actorId,
        event.productId,
        event.action,
        event.targetType,
        event.targetId,
        event.eventType,
        event.safeCode,
        event.metadataJson,
        event.durationMs,
        event.createdAt.getTime(),
        event.previousHash,
      ]),
    )
    .digest("hex");
}
function validHash(event: AuditRecord): boolean {
  return (
    /^[a-f0-9]{64}$/.test(event.integrityHash) &&
    timingSafeEqual(
      Buffer.from(event.integrityHash, "hex"),
      Buffer.from(digest(event), "hex"),
    )
  );
}
function append(
  input: Omit<Unsigned, "sequence" | "id" | "previousHash">,
): AuditRecord {
  return getSqlite()
    .transaction(() => {
      const previous = getDatabase()
        .select()
        .from(auditEvents)
        .orderBy(desc(auditEvents.sequence))
        .get();
      if (previous && !validHash(previous))
        throw new Error("AUDIT_INTEGRITY_FAILED");
      const event = {
        ...input,
        sequence: (previous?.sequence ?? 0) + 1,
        id: randomUUID(),
        previousHash: previous?.integrityHash ?? genesis,
      };
      const row = { ...event, integrityHash: digest(event) };
      getDatabase().insert(auditEvents).values(row).run();
      return row;
    })
    .immediate();
}

export function startAudit(
  details: AuditDetails,
  requestId: string = randomUUID(),
  createdAt = new Date(),
): AuditRecord {
  if (!auditActions.includes(details.action))
    throw new Error("Invalid audit action");
  if (!safeAuditId(requestId)) throw new Error("Invalid audit request ID");
  return append({
    requestId,
    attemptId: safeAuditId(details.attemptId),
    actorId: safeAuditId(details.actorId),
    productId: safeAuditId(details.productId),
    action: details.action,
    targetType: details.targetType ?? null,
    targetId: details.targetId ? targetReference(details.targetId) : null,
    eventType: "requested",
    safeCode: null,
    metadataJson: JSON.stringify(redactAuditMetadata(details.metadata)),
    durationMs: null,
    createdAt,
  });
}

export function finishAudit(
  requested: AuditRecord,
  outcome: Exclude<AuditOutcome, "requested">,
  code?: unknown,
  metadata?: AuditMetadata,
  actorId?: string | null,
  productId?: string | null,
  createdAt = new Date(),
): AuditRecord {
  const event = getSqlite()
    .transaction(() => {
      const persisted = getDatabase()
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.id, requested.id))
        .get();
      if (
        !persisted ||
        persisted.eventType !== "requested" ||
        !validHash(persisted)
      )
        throw new Error("AUDIT_INTEGRITY_FAILED");
      const existing = getDatabase()
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.requestId, requested.requestId),
            ne(auditEvents.eventType, "requested"),
          ),
        )
        .get();
      if (existing) return existing;
      return append({
        requestId: requested.requestId,
        attemptId: requested.attemptId,
        actorId: safeAuditId(actorId) ?? requested.actorId,
        productId: safeAuditId(productId) ?? requested.productId,
        action: requested.action,
        targetType: requested.targetType,
        targetId: requested.targetId,
        eventType: outcome,
        safeCode: safeAuditCode(code),
        metadataJson: JSON.stringify(
          redactAuditMetadata({
            ...JSON.parse(requested.metadataJson),
            ...metadata,
          }),
        ),
        durationMs: Math.max(
          0,
          createdAt.getTime() - requested.createdAt.getTime(),
        ),
        createdAt,
      });
    })
    .immediate();
  return event;
}

export function verifyAuditChain(): {
  valid: boolean;
  checked: number;
  head: string;
} {
  let head = genesis;
  let checked = 0;
  // Verify in bounded batches rather than loading the full history in memory.
  while (true) {
    const batch = getDatabase()
      .select()
      .from(auditEvents)
      .where(gt(auditEvents.sequence, checked))
      .orderBy(asc(auditEvents.sequence))
      .limit(500)
      .all();
    if (!batch.length) break;
    for (const event of batch) {
      if (
        event.sequence !== checked + 1 ||
        event.previousHash !== head ||
        !validHash(event)
      )
        return { valid: false, checked, head };
      head = event.integrityHash;
      checked++;
    }
  }
  return { valid: true, checked, head };
}

export function initializeAudit(): void {
  if (!verifyAuditChain().valid) throw new Error("AUDIT_INTEGRITY_FAILED");
  // Import receipts that predate the audit trail, never pretend to have historical
  // authentication/registry coverage. A transaction makes backfill restart-safe.
  const completed = getSqlite()
    .transaction(() => {
      const completed: AuditRecord[] = [];
      const receipts = getDatabase()
        .select()
        .from(operationEvents)
        .where(eq(operationEvents.eventType, "requested"))
        .orderBy(asc(operationEvents.createdAt))
        .all();
      for (const receipt of receipts) {
        const existing = getDatabase()
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.attemptId, receipt.attemptId))
          .get();
        if (existing) continue;
        const action = auditActions.find(
          (action) => action === receipt.operation,
        );
        if (!action) continue;
        const requested = startAudit(
          {
            action,
            actorId: receipt.actorId,
            productId: receipt.productId,
            attemptId: receipt.attemptId,
            targetType: action === "actions.invoke" ? "action" : "user",
            targetId: receipt.targetId,
            metadata: { imported: true },
          },
          randomUUID(),
          receipt.createdAt,
        );
        const terminal = getDatabase()
          .select()
          .from(operationEvents)
          .where(
            and(
              eq(operationEvents.attemptId, receipt.attemptId),
              ne(operationEvents.eventType, "requested"),
            ),
          )
          .get();
        completed.push(
          finishAudit(
            requested,
            terminal?.eventType === "requested"
              ? "unknown"
              : (terminal?.eventType ?? "unknown"),
            terminal?.safeCode ?? (terminal ? null : "PROCESS_INTERRUPTED"),
            {
              imported: true,
              ...(terminal?.requestId
                ? { sdkRequestId: terminal.requestId }
                : {}),
            },
            undefined,
            undefined,
            terminal?.createdAt ?? new Date(),
          ),
        );
      }
      const unresolved = getDatabase()
        .select()
        .from(auditEvents)
        .where(
          sql`${auditEvents.eventType} = 'requested' AND NOT EXISTS (SELECT 1 FROM audit_events terminal WHERE terminal.request_id = ${auditEvents.requestId} AND terminal.event_type != 'requested')`,
        )
        .all();
      for (const requested of unresolved)
        completed.push(
          finishAudit(requested, "unknown", "PROCESS_INTERRUPTED"),
        );
      return completed;
    })
    .immediate();
  // Emit only after the enclosing transaction commits, including legacy import.
  for (const event of completed) logAuditEvent(event);
}
