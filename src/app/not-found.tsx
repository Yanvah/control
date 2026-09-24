import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function NotFoundPage(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="mb-4 font-mono text-xs tracking-[0.2em] text-muted-foreground">
        404
      </p>
      <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-3 mb-6 text-sm leading-6 text-muted-foreground">
        This page does not exist in your Control instance.
      </p>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Control
      </Link>
    </main>
  );
}
