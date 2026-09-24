import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, KeyRound, Link2 } from "lucide-react";
import { requireOwner } from "@/lib/auth/server";
import { getProduct } from "@/lib/products/service";
import { ProductActions } from "@/components/products/product-actions";
import { CapabilityInspection } from "@/components/products/capability-inspection";
import {
  formatProductDate,
  productErrorMessage,
  ProductStatus,
} from "@/components/products/presentation";

export const metadata: Metadata = { title: "Product connection" };
export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  await requireOwner();
  const { id } = await params;
  const product = getProduct(id);
  if (!product) notFound();
  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/products"
          className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Products
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 max-w-full break-words text-[28px] font-semibold tracking-tight">
            {product.name}
          </h1>
          <ProductStatus product={product} />
        </div>
        <p className="mt-3 flex items-start gap-2 break-all font-mono text-xs leading-5 text-muted-foreground">
          <Link2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {product.endpoint}
        </p>
      </div>
      <ProductActions product={product} />
      <section
        aria-label="Connection details"
        className="rounded-lg border border-border bg-card"
      >
        <dl className="grid gap-5 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-[11px] text-muted-foreground">
              Last successful connection
            </dt>
            <dd className="mt-2 text-xs">
              {formatProductDate(product.lastConnectedAt)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">
              Last connection test
            </dt>
            <dd className="mt-2 text-xs">
              {formatProductDate(product.lastTestedAt)}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <KeyRound className="size-3" aria-hidden="true" />
              Credential key ID
            </dt>
            <dd className="mt-2 break-all font-mono text-xs">
              {product.keyId}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">
              Added to Control
            </dt>
            <dd className="mt-2 text-xs">
              {formatProductDate(product.createdAt)}
            </dd>
          </div>
        </dl>
        {product.lastErrorCode && (
          <div className="border-t border-border px-5 py-4">
            <h2 className="text-xs font-medium text-amber-300">
              Last connection error
            </h2>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {productErrorMessage(product.lastErrorCode)}
            </p>
          </div>
        )}
      </section>
      <div className="flex flex-wrap gap-4 text-sm text-primary">
        <Link href="/users">Search users</Link>
        {product.enabled &&
          product.capabilities?.operations.includes("users.create") && (
            <Link prefetch={false} href={`/products/${product.id}/users/new`}>
              Create user
            </Link>
          )}
        <Link prefetch={false} href={`/products/${product.id}/actions`}>
          Product actions
        </Link>
      </div>
      <CapabilityInspection product={product} />
    </div>
  );
}
