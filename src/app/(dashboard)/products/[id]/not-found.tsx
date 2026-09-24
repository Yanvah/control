import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function ProductNotFound(): React.JSX.Element {
  return (
    <section className="py-12">
      <h1 className="text-2xl font-semibold">Product not found</h1>
      <p className="mt-3 mb-6 text-sm text-muted-foreground">
        This connection may have been removed.
      </p>
      <Link href="/products" className={buttonVariants({ variant: "outline" })}>
        Back to products
      </Link>
    </section>
  );
}
