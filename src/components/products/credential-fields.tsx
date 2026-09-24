"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CredentialInput } from "@/lib/products/types";

export function CredentialFields({
  value,
  onChange,
  disabled = false,
}: {
  value: CredentialInput;
  onChange: (value: CredentialInput) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="mb-3 text-sm font-medium">Product credential</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-3 text-sm has-checked:border-primary/40 has-checked:bg-primary/5">
          <input
            className="mt-1 accent-primary"
            type="radio"
            name="credential-mode"
            checked={value.mode === "generate"}
            onChange={() => onChange({ mode: "generate" })}
          />
          <span>
            <span className="block font-medium">Generate a new credential</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Show once, then configure it in your SaaS.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-3 text-sm has-checked:border-primary/40 has-checked:bg-primary/5">
          <input
            className="mt-1 accent-primary"
            type="radio"
            name="credential-mode"
            checked={value.mode === "existing"}
            onChange={() =>
              onChange({ mode: "existing", keyId: "", secret: "" })
            }
          />
          <span>
            <span className="block font-medium">
              Use an existing credential
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Use the credential configured in your SaaS.
            </span>
          </span>
        </label>
      </div>
      {value.mode === "existing" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="product-key-id">Key ID</Label>
            <Input
              id="product-key-id"
              autoComplete="off"
              spellCheck={false}
              value={value.keyId}
              onChange={(event) =>
                onChange({ ...value, keyId: event.target.value })
              }
              maxLength={128}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-secret">Shared secret</Label>
            <Input
              id="product-secret"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={value.secret}
              onChange={(event) =>
                onChange({ ...value, secret: event.target.value })
              }
              maxLength={1024}
              required
            />
          </div>
          <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
            Use a unique secret of 32–1024 UTF-8 bytes for this product. Stored
            credentials are encrypted and cannot be shown again.
          </p>
        </div>
      )}
    </fieldset>
  );
}
