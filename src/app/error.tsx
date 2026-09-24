"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  reset,
}: {
  reset: () => void;
}): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <CircleAlert
        className="mb-5 size-7 text-muted-foreground"
        aria-hidden="true"
      />
      <h1 className="text-xl font-semibold tracking-tight">
        This page could not be loaded
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        The instance could not complete this request. Try again in a moment.
      </p>
      <Button onClick={reset} variant="outline" className="mt-6">
        Try again
      </Button>
    </main>
  );
}
