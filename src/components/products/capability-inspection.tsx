import { Blocks, Braces, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ProductView } from "@/lib/products/types";
import { formatProductDate } from "./presentation";

export function CapabilityInspection({
  product,
}: {
  product: ProductView;
}): React.JSX.Element {
  const capabilities = product.capabilities;
  if (!capabilities)
    return (
      <section className="rounded-lg border border-dashed border-border px-5 py-10 text-center">
        <Blocks
          className="mx-auto mb-3 size-6 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="text-sm font-medium">
          Capabilities have not been discovered
        </h2>
        <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted-foreground">
          A successful connection test reads the operations and custom actions
          explicitly exposed by this product.
        </p>
      </section>
    );
  return (
    <section aria-labelledby="capability-heading" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="capability-heading"
            className="text-lg font-medium tracking-tight"
          >
            Discovered capabilities
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Last confirmed {formatProductDate(product.lastConnectedAt)}. This is
            a capability inventory; actions cannot be run here.
          </p>
        </div>
        <Badge variant="secondary" className="font-mono text-[10px]">
          {capabilities.operations.length} operations ·{" "}
          {capabilities.actions.length} actions
        </Badge>
      </div>
      {(product.status !== "online" || !product.enabled) && (
        <p className="rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-3 text-xs leading-5 text-amber-300">
          Showing the last successfully discovered capabilities. They may have
          changed since the last connection.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-5 gap-y-4 rounded-lg border border-border bg-card p-5 md:grid-cols-4">
        {[
          ["Reported product", capabilities.product.name],
          ["Product ID", capabilities.product.id],
          ["SDK version", capabilities.sdkVersion],
          ["Protocol version", capabilities.protocolVersion],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="mt-2 break-all font-mono text-xs">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card">
          <h3 className="flex items-center gap-2 border-b border-border px-5 py-4 text-sm font-medium">
            <Braces className="size-4 text-primary" aria-hidden="true" />
            Operations
          </h3>
          <ul className="divide-y divide-border">
            {capabilities.operations.map((operation) => (
              <li key={operation} className="px-5 py-3 font-mono text-xs">
                {operation}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-border bg-card">
          <h3 className="flex items-center gap-2 border-b border-border px-5 py-4 text-sm font-medium">
            <ShieldAlert className="size-4 text-primary" aria-hidden="true" />
            Custom actions
          </h3>
          {capabilities.actions.length === 0 ? (
            <p className="px-5 py-6 text-xs text-muted-foreground">
              This product does not expose custom actions.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {capabilities.actions.map((action) => (
                <li key={action.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words text-sm font-medium">
                      {action.label}
                    </span>
                    <Badge
                      variant="outline"
                      className={
                        action.risk === "dangerous"
                          ? "border-destructive/25 text-[10px] text-destructive"
                          : action.risk === "caution"
                            ? "border-amber-400/25 text-[10px] text-amber-300"
                            : "text-[10px] text-muted-foreground"
                      }
                    >
                      {action.risk}
                    </Badge>
                  </div>
                  <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                    {action.id}
                  </p>
                  <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
                    {action.description}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
