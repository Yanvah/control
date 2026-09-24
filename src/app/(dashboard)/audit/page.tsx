import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/server";
import { listAuditEvents, parseAuditFilters } from "@/lib/audit/query";
import { auditActions } from "@/lib/audit/models";
import { AuditTable } from "@/components/audit/audit-table";
import { IntegrityCheck } from "@/components/audit/integrity-check";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata: Metadata = { title: "Audit Log" };
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  await requireOwner();
  const parameters = await searchParams;
  let filters;
  try {
    filters = parseAuditFilters(parameters);
  } catch {
    return (
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">Audit Log</h1>
        <p role="alert" className="my-5 text-sm">
          Check the filters: IDs must be valid UUIDs, and dates must be a valid
          range.
        </p>
        <Link href="/audit" className={buttonVariants({ variant: "outline" })}>
          Reset filters
        </Link>
      </div>
    );
  }
  const { events, nextCursor } = listAuditEvents(filters);
  const next = new URLSearchParams(
    Object.entries(filters).map(([key, value]) => [key, String(value)]),
  );
  if (nextCursor) next.set("before", String(nextCursor));
  const selectClass =
    "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">
            Audit Log
          </h1>
          <p className="text-sm text-muted-foreground">
            Review actions, outcomes, and security events.
          </p>
        </div>
        <IntegrityCheck />
      </div>
      <form
        action="/audit"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div className="space-y-2">
          <Label htmlFor="audit-outcome">Outcome</Label>
          <select
            id="audit-outcome"
            name="outcome"
            defaultValue={filters.outcome}
            className={selectClass}
          >
            {[
              "completed",
              "all",
              "requested",
              "succeeded",
              "failed",
              "unknown",
              "attention",
            ].map((value) => (
              <option key={value} value={value}>
                {value === "attention"
                  ? "Failed or unknown"
                  : value.charAt(0).toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="audit-action">Action</Label>
          <select
            id="audit-action"
            name="action"
            defaultValue={filters.action ?? ""}
            className={selectClass}
          >
            <option value="">All actions</option>
            {auditActions.map((action) => (
              <option key={action}>{action}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="audit-product">Product ID</Label>
          <Input
            id="audit-product"
            name="productId"
            defaultValue={filters.productId}
            placeholder="Any product"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="audit-request">Request ID</Label>
          <Input
            id="audit-request"
            name="requestId"
            defaultValue={filters.requestId}
            placeholder="Any request"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="audit-from">From (UTC)</Label>
          <Input
            id="audit-from"
            name="from"
            type="date"
            defaultValue={filters.from}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="audit-to">Through (UTC)</Label>
          <Input
            id="audit-to"
            name="to"
            type="date"
            defaultValue={filters.to}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit">Apply filters</Button>
          <Link
            href="/audit"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Reset
          </Link>
        </div>
      </form>
      <AuditTable events={events} />
      {nextCursor !== null && (
        <Link
          href={`/audit?${next}`}
          className={buttonVariants({ variant: "outline" })}
        >
          Older events
        </Link>
      )}
    </div>
  );
}
