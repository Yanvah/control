import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/server";
import { auditEventSequence } from "@/lib/audit/query";
import { RequestError } from "@/lib/security/request";
import { AuditOutcome } from "@/components/audit/audit-table";
export const metadata: Metadata = { title: "Audit event" };
export default async function AuditDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  await requireOwner();
  let events;
  try {
    events = auditEventSequence((await params).id);
  } catch (error) {
    if (error instanceof RequestError && error.status === 404) notFound();
    throw error;
  }
  const first = events[0];
  return (
    <div className="max-w-4xl space-y-7">
      <Link
        href="/audit"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Audit Log
      </Link>
      <h1 className="text-[28px] font-semibold tracking-tight">
        {first.action}
      </h1>
      <dl className="grid gap-5 rounded-lg border border-border p-5 sm:grid-cols-2">
        {Object.entries({
          "Request ID": first.requestId,
          "Attempt ID": first.attemptId,
          "Actor ID": events.at(-1)?.actorId ?? "Unauthenticated",
          "Product ID": events.at(-1)?.productId ?? "—",
          "Target type": first.targetType ?? "—",
          "Target reference": first.targetId ?? "—",
        }).map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-2 break-all font-mono text-sm">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>
      {first.targetId && (
        <p className="text-sm text-muted-foreground">
          The target reference is a keyed hash. Matching references identify the
          same target without storing its raw ID.
        </p>
      )}
      <ol className="space-y-4" aria-label="Event sequence">
        {events.map((event) => (
          <li
            key={event.id}
            className="space-y-4 rounded-lg border border-border bg-card p-5"
          >
            <div className="flex flex-wrap justify-between gap-3 text-sm">
              <AuditOutcome outcome={event.eventType} />
              <time>{event.createdAt.replace("T", " ")} (UTC)</time>
            </div>
            {event.eventType === "unknown" && (
              <p className="text-sm">
                The operation may have completed. Check the affected state
                before making another attempt.
              </p>
            )}
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Duration</dt>
                <dd>
                  {event.durationMs === null ? "—" : `${event.durationMs} ms`}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Result code</dt>
                <dd>{event.safeCode ?? "—"}</dd>
              </div>
            </dl>
            {Object.keys(event.metadata).length > 0 && (
              <pre className="overflow-auto whitespace-pre-wrap break-all text-sm">
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Integrity details
              </summary>
              <dl className="mt-3 space-y-3 break-all font-mono">
                <dt>Event ID</dt>
                <dd>{event.id}</dd>
                <dt>Previous hash</dt>
                <dd>{event.previousHash}</dd>
                <dt>Event hash</dt>
                <dd>{event.integrityHash}</dd>
              </dl>
            </details>
          </li>
        ))}
      </ol>
      {events.length === 1 && (
        <p role="status" className="text-sm text-muted-foreground">
          No outcome recorded yet. The operation may still be in progress; do
          not repeat it automatically.
        </p>
      )}
    </div>
  );
}
