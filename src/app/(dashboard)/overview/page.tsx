import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Fingerprint,
  KeyRound,
  Laptop,
  ShieldCheck,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { requireOwner } from "@/lib/auth/server";
import { listOwnerPasskeys, listOwnerSessions } from "@/lib/auth/management";
import { listProducts } from "@/lib/products/service";
import {
  ProductStatus,
  formatProductDate,
} from "@/components/products/presentation";
import { listAuditEvents } from "@/lib/audit/query";
import { AuditOutcome } from "@/components/audit/audit-table";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage(): Promise<React.JSX.Element> {
  const { user, session } = await requireOwner();
  const products = listProducts();
  const recentEvents = listAuditEvents({ outcome: "completed" }, 5).events;
  const passkeyCount = listOwnerPasskeys(user.id).length;
  const sessionCount = listOwnerSessions(user.id, session.id).length;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Welcome back, {user.name}.
          </p>
        </div>
      </div>
      <section
        aria-labelledby="security-heading"
        className="mt-9 overflow-hidden rounded-lg border border-border bg-card"
      >
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-5">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            <h2 id="security-heading" className="text-sm font-semibold">
              Account security
            </h2>
          </div>
          <Link
            href="/settings"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
          >
            Manage access
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
        <dl className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
          <SecurityItem
            icon={Fingerprint}
            label="Registered passkeys"
            value={String(passkeyCount)}
            detail={
              passkeyCount
                ? "Ready for passwordless sign-in"
                : "Add one for secure, simple sign-in"
            }
          />
          <SecurityItem
            icon={Laptop}
            label="Active sessions"
            value={String(sessionCount)}
            detail="Review and revoke in Settings"
          />
        </dl>
      </section>
      {passkeyCount === 0 && (
        <section className="mt-5 flex flex-col justify-between gap-5 rounded-lg border border-primary/20 bg-primary/[0.035] px-5 py-5 sm:flex-row sm:items-center">
          <div className="flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/15 bg-primary/5">
              <KeyRound className="size-4 text-primary" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-medium">
                Make your next sign-in a little easier.
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Add a passkey using your device or a security key.
              </p>
            </div>
          </div>
          <Link
            href="/settings#passkeys-heading"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "shrink-0",
            )}
          >
            Add a passkey
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </section>
      )}
      <section
        aria-labelledby="products-heading"
        className="mt-9 overflow-hidden rounded-lg border border-border bg-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-5">
          <div>
            <h2 id="products-heading" className="text-sm font-semibold">
              Product connections
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Last observed status, refreshed when you test a connection.
            </p>
          </div>
          <Link
            href="/products"
            className="flex items-center gap-1.5 text-xs text-primary"
          >
            Manage products
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
        {products.length === 0 ? (
          <div className="px-5 py-8">
            <h3 className="text-sm font-medium">Connect your first product</h3>
            <p className="mt-2 mb-5 text-xs leading-5 text-muted-foreground">
              Add a SaaS endpoint to discover its supported capabilities and
              check its connection.
            </p>
            <Link
              href="/products/new"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Add product
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {products.slice(0, 5).map((product) => (
              <li key={product.id}>
                <Link
                  href={`/products/${product.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-secondary/20"
                >
                  <div className="min-w-0">
                    <span className="block break-words text-sm font-medium">
                      {product.name}
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {product.capabilities
                        ? `${product.capabilities.operations.length} operations · ${product.capabilities.actions.length} actions`
                        : "Capabilities not discovered"}{" "}
                      · Last connected{" "}
                      {formatProductDate(product.lastConnectedAt)}
                    </span>
                  </div>
                  <ProductStatus product={product} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {products.length > 5 && (
          <Link
            href="/products"
            className="block border-t border-border px-5 py-3 text-xs text-primary"
          >
            View all {products.length} products
          </Link>
        )}
      </section>
      <section
        aria-labelledby="activity-heading"
        className="mt-9 overflow-hidden rounded-lg border border-border bg-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-5">
          <h2 id="activity-heading" className="text-sm font-semibold">
            Recent activity
          </h2>
          <div className="flex gap-4 text-sm">
            <Link
              href="/audit?outcome=attention"
              className="text-muted-foreground hover:text-foreground"
            >
              Failed or unknown
            </Link>
            <Link href="/audit" className="text-primary">
              View audit log
            </Link>
          </div>
        </div>
        <ul className="divide-y divide-border">
          {recentEvents.map((event) => (
            <li key={event.id}>
              <Link
                href={`/audit/${event.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm hover:bg-secondary/20"
              >
                <span>{event.action}</span>
                <span className="flex gap-4">
                  <time className="text-muted-foreground">
                    {event.createdAt.replace("T", " ").slice(0, 16)} UTC
                  </time>
                  <AuditOutcome outcome={event.eventType} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {!recentEvents.length && (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No activity recorded yet.
          </p>
        )}
      </section>
    </div>
  );
}

function SecurityItem({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Fingerprint;
  label: string;
  value: string;
  detail: string;
}): React.JSX.Element {
  return (
    <div className="px-5 py-6">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-4 text-2xl font-medium tracking-tight">{value}</dd>
      <dd className="mt-2 text-[11px] text-muted-foreground">{detail}</dd>
    </div>
  );
}
