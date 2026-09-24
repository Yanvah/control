"use client";
import { useMemo } from "react";
import Link from "next/link";
import { tableFeatures, useTable, type ColumnDef } from "@tanstack/react-table";
import type { AuditEventView } from "@/lib/audit/models";

const features = tableFeatures({});
export function AuditOutcome({
  outcome,
}: {
  outcome: string;
}): React.JSX.Element {
  const color =
    outcome === "unknown"
      ? "text-amber-300"
      : outcome === "failed"
        ? "text-destructive"
        : outcome === "succeeded"
          ? "text-primary"
          : "text-muted-foreground";
  return <span className={`capitalize ${color}`}>{outcome}</span>;
}
export function AuditTable({
  events,
}: {
  events: AuditEventView[];
}): React.JSX.Element {
  const columns = useMemo<ColumnDef<typeof features, AuditEventView>[]>(
    () => [
      {
        id: "time",
        header: "Time (UTC)",
        cell: ({ row }) => (
          <time dateTime={row.original.createdAt}>
            {row.original.createdAt.replace("T", " ").slice(0, 19)}
          </time>
        ),
      },
      {
        id: "action",
        header: "Action",
        cell: ({ row }) => (
          <Link
            className="font-medium hover:text-primary"
            href={`/audit/${row.original.id}`}
          >
            {row.original.action}
          </Link>
        ),
      },
      {
        id: "outcome",
        header: "Outcome",
        cell: ({ row }) => <AuditOutcome outcome={row.original.eventType} />,
      },
      {
        id: "actor",
        header: "Actor",
        cell: ({ row }) => (row.original.actorId ? "Owner" : "Unauthenticated"),
      },
      {
        id: "product",
        header: "Product ID",
        cell: ({ row }) => (
          <span
            title={row.original.productId ?? undefined}
            className="font-mono"
          >
            {row.original.productId?.slice(0, 8) ?? "—"}
          </span>
        ),
      },
      {
        id: "duration",
        header: "Duration",
        cell: ({ row }) =>
          row.original.durationMs === null
            ? "—"
            : `${row.original.durationMs} ms`,
      },
    ],
    [],
  );
  const table = useTable({ features, data: events, columns });
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Audit events, newest first</caption>
        <thead className="border-b border-border bg-card text-muted-foreground">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th
                  key={header.id}
                  scope="col"
                  className="whitespace-nowrap px-4 py-3 font-medium"
                >
                  {header.isPlaceholder ? null : (
                    <table.FlexRender header={header} />
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-border">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-secondary/20">
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className="whitespace-nowrap px-4 py-4">
                  {<table.FlexRender cell={cell} />}
                </td>
              ))}
            </tr>
          ))}
          {!events.length && (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-10 text-center text-muted-foreground"
              >
                No events match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
