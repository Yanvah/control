"use client";
import { useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
const resultSchema = z.object({
  valid: z.boolean(),
  checked: z.number().int().nonnegative(),
  head: z.string().regex(/^[a-f0-9]{64}$/),
});
export function IntegrityCheck(): React.JSX.Element {
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function verify(): Promise<void> {
    if (active.current) return;
    active.current = true;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/audit/integrity", {
        cache: "no-store",
      });
      if (!response.ok) {
        setMessage(
          response.status === 429
            ? "Wait a minute before checking again."
            : "Could not verify the audit history.",
        );
        return;
      }
      const result = resultSchema.parse(await response.json());
      setMessage(
        result.valid
          ? `Verified ${result.checked} events. Chain head: ${result.head}`
          : "Integrity check failed. Stop operations and inspect the database using a trusted backup.",
      );
    } catch {
      setMessage("Could not verify the audit history.");
    } finally {
      active.current = false;
      setPending(false);
    }
  }
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => void verify()}
      >
        {pending ? "Verifying…" : "Verify integrity"}
      </Button>
      {message && (
        <p
          role="status"
          className="max-w-2xl break-words text-sm text-muted-foreground"
        >
          {message}
        </p>
      )}
    </div>
  );
}
