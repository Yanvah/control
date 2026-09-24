import Link from "next/link";
import { FormMessage } from "@/components/auth/form-message";

export function ProductFeedback({
  error,
  notice,
  reauthenticate,
  destination,
}: {
  error: string | null;
  notice?: string | null;
  reauthenticate: boolean;
  destination: string;
}): React.JSX.Element {
  return (
    <div aria-live="polite" className="space-y-3">
      {notice && (
        <p
          role="status"
          className="rounded-md border border-primary/20 bg-primary/5 px-3 py-3 text-sm text-primary"
        >
          {notice}
        </p>
      )}
      <FormMessage message={error} />
      {reauthenticate && (
        <Link
          className="inline-block text-sm text-primary underline underline-offset-4"
          href={`/login?reauth=1&next=${encodeURIComponent(destination)}`}
        >
          Sign in again
        </Link>
      )}
    </div>
  );
}
