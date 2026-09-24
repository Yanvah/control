import "server-only";
import { and, desc, eq, gte, lte, lt, ne, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/db/client";
import { auditEvents } from "@/db/schema";
import { RequestError } from "@/lib/security/request";
import { auditActions, type AuditEventView } from "./models";
import { redactAuditMetadata } from "./redaction";
import type { AuditRecord } from "./store";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  });
export const auditFilterSchema = z
  .object({
    outcome: z
      .enum([
        "completed",
        "all",
        "requested",
        "succeeded",
        "failed",
        "unknown",
        "attention",
      ])
      .default("completed"),
    action: z.enum(auditActions).optional(),
    productId: z.uuid().optional(),
    requestId: z.uuid().optional(),
    actorId: z.uuid().optional(),
    from: date.optional(),
    to: date.optional(),
    before: z.coerce
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .refine(
    (filters) => !filters.from || !filters.to || filters.from <= filters.to,
  );
export type AuditFilters = z.infer<typeof auditFilterSchema>;

export function parseAuditFilters(
  input: Record<string, unknown>,
): AuditFilters {
  const result = auditFilterSchema.safeParse(
    Object.fromEntries(
      Object.entries(input).filter(
        ([, value]) => value !== "" && value !== undefined,
      ),
    ),
  );
  if (!result.success) throw new RequestError(400, "INVALID_REQUEST");
  return result.data;
}
function view(row: AuditRecord): AuditEventView {
  const { metadataJson, ...fields } = row;
  return {
    ...fields,
    metadata: redactAuditMetadata(JSON.parse(metadataJson)),
    createdAt: row.createdAt.toISOString(),
  };
}
export function listAuditEvents(
  filters: AuditFilters,
  limit = 50,
): { events: AuditEventView[]; nextCursor: number | null } {
  const conditions = [];
  if (filters.outcome === "completed")
    conditions.push(ne(auditEvents.eventType, "requested"));
  else if (filters.outcome === "attention")
    conditions.push(inArray(auditEvents.eventType, ["failed", "unknown"]));
  else if (filters.outcome !== "all")
    conditions.push(eq(auditEvents.eventType, filters.outcome));
  if (filters.action) conditions.push(eq(auditEvents.action, filters.action));
  if (filters.productId)
    conditions.push(eq(auditEvents.productId, filters.productId));
  if (filters.requestId)
    conditions.push(eq(auditEvents.requestId, filters.requestId));
  if (filters.actorId)
    conditions.push(eq(auditEvents.actorId, filters.actorId));
  if (filters.from)
    conditions.push(
      gte(auditEvents.createdAt, new Date(`${filters.from}T00:00:00.000Z`)),
    );
  if (filters.to)
    conditions.push(
      lte(auditEvents.createdAt, new Date(`${filters.to}T23:59:59.999Z`)),
    );
  if (filters.before) conditions.push(lt(auditEvents.sequence, filters.before));
  const pageSize = Math.min(50, Math.max(1, limit));
  const rows = getDatabase()
    .select()
    .from(auditEvents)
    .where(and(...conditions))
    .orderBy(desc(auditEvents.sequence))
    .limit(pageSize + 1)
    .all();
  return {
    events: rows.slice(0, pageSize).map(view),
    nextCursor: rows.length > pageSize ? rows[pageSize - 1].sequence : null,
  };
}
export function auditEventSequence(id: string): AuditEventView[] {
  if (!z.uuid().safeParse(id).success) throw new RequestError(404, "NOT_FOUND");
  const event = getDatabase()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.id, id))
    .get();
  if (!event) throw new RequestError(404, "NOT_FOUND");
  return getDatabase()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.requestId, event.requestId))
    .orderBy(auditEvents.sequence)
    .all()
    .map(view);
}
