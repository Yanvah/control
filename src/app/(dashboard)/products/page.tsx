import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ProductsTable } from "@/components/products/products-table";
import { requireOwner } from "@/lib/auth/server";
import { listProducts } from "@/lib/products/service";

export const metadata: Metadata = { title: "Products" };
export default async function ProductsPage(): Promise<React.JSX.Element> {
  await requireOwner();
  const products = listProducts();
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Products</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Your SaaS connections, credentials, and discovered capabilities.
          </p>
        </div>
        <Link href="/products/new" className={buttonVariants()}>
          <Plus className="size-4" aria-hidden="true" />
          Add product
        </Link>
      </div>
      <ProductsTable products={products} />
    </div>
  );
}
