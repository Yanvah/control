"use client";

import { useEffect, useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OneTimeCredential({
  credentials,
  onDismiss,
}: {
  credentials: { keyId: string; secret: string };
  onDismiss: () => void;
}): React.JSX.Element {
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(
        `YANVAH_CONTROL_KEY_ID=${credentials.keyId}\nYANVAH_CONTROL_SECRET=${credentials.secret}`,
      );
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  }
  return (
    <section
      aria-labelledby="credential-once-heading"
      className="mx-auto max-w-2xl rounded-lg border border-amber-400/25 bg-card p-6"
    >
      <KeyRound className="mb-4 size-6 text-amber-300" aria-hidden="true" />
      <h2
        id="credential-once-heading"
        className="text-xl font-semibold tracking-tight"
      >
        Save this credential now
      </h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        This is the only time Control can show this secret. Save it in your
        secret manager and configure the same key ID and secret in your SaaS
        before testing the connection.
      </p>
      <p className="mt-3 text-xs leading-5 text-amber-300">
        Leaving this page or dismissing this panel hides the secret permanently.
        If it is lost, replace the credential.
      </p>
      <div className="my-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="generated-key-id">Generated key ID</Label>
          <Input
            id="generated-key-id"
            className="font-mono text-xs"
            readOnly
            value={credentials.keyId}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="generated-secret">Generated shared secret</Label>
          <Input
            id="generated-secret"
            className="font-mono text-xs"
            readOnly
            value={credentials.secret}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copy()}
        >
          <Copy className="size-3.5" aria-hidden="true" />
          {copied ? "Copied credential" : "Copy credential"}
        </Button>
        {copyFailed && (
          <p role="alert" className="text-xs text-amber-300">
            Clipboard access is unavailable. Select and copy both fields
            manually.
          </p>
        )}
      </div>
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1 accent-primary"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <span>
          Saved the credential safely. I understand it cannot be retrieved.
        </span>
      </label>
      <Button
        type="button"
        className="mt-5"
        disabled={!acknowledged}
        onClick={onDismiss}
      >
        Continue to product
      </Button>
    </section>
  );
}
