"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CredentialFields } from "./credential-fields";
import { OneTimeCredential } from "./one-time-credential";
import { ProductFeedback } from "./product-feedback";
import { productErrorMessage } from "./presentation";
import type { CredentialInput } from "@/lib/products/types";

const createdProductSchema = z.object({
  product: z.object({ id: z.uuid() }),
  credentials: z.object({ keyId: z.string(), secret: z.string() }).optional(),
});

export function AddProductForm(): React.JSX.Element {
  const router = useRouter();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [credentials, setCredentials] = useState<CredentialInput>({
    mode: "generate",
  });
  const [created, setCreated] = useState<z.infer<
    typeof createdProductSchema
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reauthenticate, setReauthenticate] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    submitting.current = true;
    setPending(true);
    setError(null);
    setReauthenticate(false);
    try {
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          endpoint: String(form.get("endpoint") ?? ""),
          credentials,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const result = z.object({ error: z.string() }).safeParse(payload);
        const code = result.success ? result.data.error : "REQUEST_FAILED";
        setReauthenticate(
          code === "RECENT_AUTHENTICATION_REQUIRED" || response.status === 401,
        );
        setError(productErrorMessage(code));
        return;
      }
      const result = createdProductSchema.safeParse(payload);
      if (!result.success) throw new Error("Unconfirmed result");
      if (credentials.mode === "generate" && !result.data.credentials)
        throw new Error("Missing generated credential");
      setCredentials({ mode: "generate" });
      if (result.data.credentials) setCreated(result.data);
      else {
        router.replace(`/products/${result.data.product.id}`);
        router.refresh();
      }
    } catch {
      setError(
        "Product creation could not be confirmed. Check the product list before trying again. If a generated credential was lost, replace it from the product page.",
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  if (created?.credentials)
    return (
      <OneTimeCredential
        credentials={created.credentials}
        onDismiss={() => {
          const id = created.product.id;
          setCreated(null);
          router.replace(`/products/${id}`);
          router.refresh();
        }}
      />
    );

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="max-w-2xl space-y-6"
    >
      <fieldset
        disabled={pending}
        className="space-y-5 rounded-lg border border-border bg-card p-5 sm:p-6"
      >
        <div className="space-y-2">
          <Label htmlFor="product-name">Product name</Label>
          <Input
            id="product-name"
            name="name"
            placeholder="For example, Acme Cloud"
            maxLength={200}
            required
          />
          <p className="text-xs text-muted-foreground">
            A name for this connection in your Control workspace.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-endpoint">Endpoint URL</Label>
          <Input
            id="product-endpoint"
            name="endpoint"
            type="url"
            placeholder="https://app.example.com/api/yanvah-control"
            autoComplete="off"
            spellCheck={false}
            maxLength={2048}
            required
          />
          <p className="text-xs leading-5 text-muted-foreground">
            The SDK endpoint exposed by your SaaS. Control checks the
            destination before saving and before every connection.
          </p>
        </div>
        <div className="border-t border-border pt-5">
          <CredentialFields
            value={credentials}
            onChange={setCredentials}
            disabled={pending}
          />
        </div>
      </fieldset>
      <div className="flex gap-2 text-xs leading-5 text-muted-foreground">
        <ShieldCheck
          className="mt-0.5 size-4 shrink-0 text-primary"
          aria-hidden="true"
        />
        <p>
          Credentials are encrypted in your database. Saving adds the
          connection; test it after both sides are configured. A recent sign-in
          is required.
        </p>
      </div>
      <ProductFeedback
        error={error}
        reauthenticate={reauthenticate}
        destination="/products/new"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding product…" : "Add product"}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
        <Link
          href="/products"
          className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
