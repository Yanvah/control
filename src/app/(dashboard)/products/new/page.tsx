import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AddProductForm } from "@/components/products/add-product-form";
import { requireOwner } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Add product" };
export default async function NewProductPage(): Promise<React.JSX.Element> {
  await requireOwner();
  return (
    <div>
      <Link
        href="/products"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Products
      </Link>
      <h1 className="text-[28px] font-semibold tracking-tight">
        Add a product
      </h1>
      <p className="mt-2 mb-8 max-w-2xl text-sm leading-6 text-muted-foreground">
        Connect a SaaS through its SDK endpoint. Each product uses an
        independent credential.
      </p>
      <AddProductForm />
    </div>
  );
}
