"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  createSortedRowModel,
  rowSortingFeature,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { ArrowRight, ArrowUpDown, Boxes, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ProductView } from "@/lib/products/types";
import { formatProductDate, ProductStatus } from "./presentation";

const features = tableFeatures({
  rowSortingFeature,
  sortFns: { text: sortFn_text },
  sortedRowModel: createSortedRowModel(),
});

export function ProductsTable({
  products,
}: {
  products: ProductView[];
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const data = useMemo(
    () =>
      products.filter((product) =>
        `${product.name} ${product.endpoint}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [products, search],
  );
  const columns = useMemo<ColumnDef<typeof features, ProductView>[]>(
    () => [
      {
        accessorKey: "name",
        sortFn: "text",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => column.toggleSorting()}
            className="-ml-2 h-7 text-xs"
          >
            Product
            <ArrowUpDown className="size-3" aria-hidden="true" />
          </Button>
        ),
        cell: ({ row }) => (
          <Link
            href={`/products/${row.original.id}`}
            className="block max-w-xs py-1 hover:text-primary"
          >
            <span className="block truncate text-sm font-medium">
              {row.original.name}
            </span>
            <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
              {row.original.endpoint}
            </span>
          </Link>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <ProductStatus product={row.original} />,
      },
      {
        id: "capabilities",
        header: "Capabilities",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.capabilities
              ? `${row.original.capabilities.operations.length} operations · ${row.original.capabilities.actions.length} actions`
              : "Not discovered"}
          </span>
        ),
      },
      {
        accessorKey: "lastConnectedAt",
        header: "Last connected",
        cell: ({ row }) => (
          <span className="text-[11px] text-muted-foreground">
            {formatProductDate(row.original.lastConnectedAt)}
          </span>
        ),
      },
      {
        id: "open",
        header: () => <span className="sr-only">Open product</span>,
        cell: ({ row }) => (
          <Link
            href={`/products/${row.original.id}`}
            aria-label={`Open ${row.original.name}`}
            className="inline-flex rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-primary"
          >
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        ),
      },
    ],
    [],
  );
  const table = useTable({
    features,
    data,
    columns,
    initialState: { sorting: [{ id: "name", desc: false }] },
  });

  if (products.length === 0)
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center">
        <Boxes
          className="mx-auto mb-5 size-8 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="text-lg font-medium">Connect your first product</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Add a SaaS with a Yanvah Control SDK endpoint to inspect its
          capabilities and connection status.
        </p>
        <Link
          href="/products/new"
          className={`${buttonVariants({ variant: "outline" })} mt-6`}
        >
          Add product
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search
            className="absolute top-3 left-3 size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            aria-label="Filter products"
            placeholder="Filter by name or endpoint…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {table.getRowModel().rows.length} of {products.length} products
        </p>
      </div>
      <div className="relative overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[720px] text-left">
          <caption className="sr-only">
            Registered products and their last observed connection status
          </caption>
          <thead className="border-b border-border bg-secondary/25">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    aria-sort={
                      header.column.getCanSort()
                        ? header.column.getIsSorted() === "asc"
                          ? "ascending"
                          : header.column.getIsSorted() === "desc"
                            ? "descending"
                            : "none"
                        : undefined
                    }
                    className="px-5 py-3 text-[11px] font-medium text-muted-foreground"
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
              <tr key={row.id} className="hover:bg-secondary/15">
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} className="px-5 py-4">
                    {<table.FlexRender cell={cell} />}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-5 py-12 text-center text-sm text-muted-foreground"
                >
                  No products match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-5 text-muted-foreground">
        Status reflects the most recent connection test. Connections are tested
        on demand.
      </p>
    </div>
  );
}
