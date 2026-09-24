import { CircleAlert } from "lucide-react";

export function FormMessage({
  message,
}: {
  message: string | null;
}): React.JSX.Element | null {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs leading-5 text-destructive"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
