import type { JsonValue } from "@yanvah/control";
export function JsonResult({ value }: { value: JsonValue }): React.JSX.Element {
  const compact = JSON.stringify(value);
  const truncated = compact.length > 32_768;
  const preview =
    compact.length <= 8192
      ? JSON.stringify(value, null, 2)
      : compact.slice(0, 32_768);
  return (
    <div>
      {truncated && (
        <p className="mb-2 text-xs text-muted-foreground">
          Large result: preview limited to 32,768 characters.
        </p>
      )}
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-secondary/40 p-3 text-xs">
        {preview}
      </pre>
    </div>
  );
}
