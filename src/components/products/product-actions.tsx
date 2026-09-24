"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { CredentialInput, ProductView } from "@/lib/products/types";
import { CredentialFields } from "./credential-fields";
import { OneTimeCredential } from "./one-time-credential";
import { ProductFeedback } from "./product-feedback";
import { productErrorMessage } from "./presentation";

type Change = "disable" | "enable" | "replace" | "remove";
const requestFailed = Symbol("request failed");
const credentialResponseSchema = z.object({
  product: z.object({ id: z.uuid(), enabled: z.boolean() }),
  credentials: z.object({ keyId: z.string(), secret: z.string() }).optional(),
});
const testResponseSchema = z.object({
  product: z.object({
    status: z.enum(["online", "offline", "degraded", "unknown"]),
    lastErrorCode: z.string().nullable(),
  }),
});

export function ProductActions({
  product,
}: {
  product: ProductView;
}): React.JSX.Element {
  const router = useRouter();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [change, setChange] = useState<Change | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [credentials, setCredentials] = useState<CredentialInput>({
    mode: "generate",
  });
  const [generated, setGenerated] = useState<{
    keyId: string;
    secret: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reauthenticate, setReauthenticate] = useState(false);
  const busy = pending || refreshing;
  const base = `/api/products/${product.id}`;

  function refresh(): void {
    startRefresh(() => router.refresh());
  }
  function openChange(next: Change): void {
    setChange(next);
    setConfirmation("");
    setCredentials({ mode: "generate" });
    setError(null);
    setNotice(null);
  }
  async function request(
    path: string,
    method: string,
    body: unknown,
  ): Promise<unknown> {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const parsed = z.object({ error: z.string() }).safeParse(payload);
      const code = parsed.success ? parsed.data.error : "REQUEST_FAILED";
      setReauthenticate(
        code === "RECENT_AUTHENTICATION_REQUIRED" || response.status === 401,
      );
      setError(productErrorMessage(code));
      return requestFailed;
    }
    return payload;
  }
  async function testConnection(): Promise<void> {
    if (submitting.current || busy || !product.enabled) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    setReauthenticate(false);
    try {
      const payload = await request(`${base}/test`, "POST", {});
      if (payload === requestFailed) return;
      const result = testResponseSchema.safeParse(payload);
      if (!result.success) throw new Error("Unconfirmed test");
      if (result.data.product.status === "online")
        setNotice("Connected successfully. Capabilities are up to date.");
      else setError(productErrorMessage(result.data.product.lastErrorCode));
      refresh();
    } catch {
      setError(
        "The connection test could not be confirmed. Refresh to check the latest recorded status before testing again.",
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  async function confirmChange(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (
      !change ||
      submitting.current ||
      busy ||
      ((change === "remove" || change === "replace") &&
        confirmation !== product.name)
    )
      return;
    submitting.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    setReauthenticate(false);
    try {
      const method =
        change === "remove"
          ? "DELETE"
          : change === "replace"
            ? "POST"
            : "PATCH";
      const body =
        change === "remove"
          ? { confirmation }
          : change === "replace"
            ? { credentials, confirmation }
            : { enabled: change === "enable" };
      const payload = await request(
        change === "replace" ? `${base}/credentials` : base,
        method,
        body,
      );
      if (payload === requestFailed) {
        setChange(null);
        return;
      }
      if (change === "remove") {
        if (!z.object({ ok: z.literal(true) }).safeParse(payload).success)
          throw new Error("Unconfirmed removal");
        router.replace("/products");
        router.refresh();
        return;
      }
      const result = credentialResponseSchema.safeParse(payload);
      if (!result.success || result.data.product.id !== product.id)
        throw new Error("Unconfirmed product change");
      if (change === "replace") {
        if (credentials.mode === "generate" && !result.data.credentials)
          throw new Error("Missing generated credential");
        setCredentials({ mode: "generate" });
        if (result.data.credentials) setGenerated(result.data.credentials);
        else
          setNotice(
            "Credential replaced. Make sure the SaaS uses the new credential, then test the connection.",
          );
      } else
        setNotice(
          change === "enable"
            ? "Product enabled. Test its connection to refresh status and capabilities."
            : "Product disabled. Control will not connect to this endpoint until you enable it.",
        );
      setChange(null);
      refresh();
    } catch {
      setChange(null);
      setError(
        "Outcome unknown. Refresh this product to check the saved state before repeating the change. If a generated credential was lost, replace it.",
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  if (generated)
    return (
      <OneTimeCredential
        credentials={generated}
        onDismiss={() => {
          setGenerated(null);
          setNotice(
            "Credential saved. Configure the same credential in your SaaS, then test the connection.",
          );
          refresh();
        }}
      />
    );

  const title =
    change === "remove"
      ? "Remove this product?"
      : change === "replace"
        ? "Replace this credential?"
        : change === "disable"
          ? "Disable this product?"
          : "Enable this product?";
  const actionLabel =
    change === "remove"
      ? "Remove product"
      : change === "replace"
        ? "Replace credential"
        : change === "disable"
          ? "Disable product"
          : "Enable product";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => void testConnection()}
          disabled={busy || !product.enabled}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {pending && !change
            ? "Testing connection…"
            : product.lastTestedAt
              ? "Reconnect"
              : "Test connection"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => openChange(product.enabled ? "disable" : "enable")}
        >
          {product.enabled ? (
            <Pause className="size-3.5" aria-hidden="true" />
          ) : (
            <Play className="size-3.5" aria-hidden="true" />
          )}
          {product.enabled ? "Disable product" : "Enable product"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => openChange("replace")}
        >
          <KeyRound className="size-3.5" aria-hidden="true" />
          Replace credential
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={busy}
          onClick={() => openChange("remove")}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Remove product
        </Button>
      </div>
      {!product.enabled && (
        <p className="text-xs text-muted-foreground">
          Connection testing is paused while this product is disabled.
        </p>
      )}
      <ProductFeedback
        error={error}
        notice={notice}
        reauthenticate={reauthenticate}
        destination={`/products/${product.id}`}
      />
      {error && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={refresh}>
          Refresh current state
        </Button>
      )}
      <AlertDialog
        open={change !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setChange(null);
        }}
      >
        <AlertDialogContent
          className={
            change === "replace"
              ? "max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
              : ""
          }
        >
          <form
            onSubmit={(event) => void confirmChange(event)}
            className="space-y-5"
          >
            <AlertDialogHeader>
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription>
                {change === "remove"
                  ? `Remove “${product.name}” and its stored credential from Control. Its SaaS data is unaffected. This connection cannot be restored without adding it again.`
                  : change === "replace"
                    ? `Replace the credential used for “${product.name}”. The saved secret cannot be recovered, and connections will fail until both sides use the same new credential.`
                    : change === "disable"
                      ? `Stop all connections from Control to “${product.name}”. Its saved configuration stays here and can be enabled again.`
                      : `Allow Control to connect to “${product.name}” again. Test the connection afterward to refresh its capabilities.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="break-all rounded-md border border-border bg-secondary/30 px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {product.endpoint}
            </p>
            {change === "replace" && (
              <CredentialFields
                value={credentials}
                onChange={setCredentials}
                disabled={busy}
              />
            )}
            {(change === "remove" || change === "replace") && (
              <div className="space-y-2">
                <Label htmlFor="product-confirmation">
                  Type the product name to confirm
                </Label>
                <Input
                  id="product-confirmation"
                  autoComplete="off"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={busy}
                  required
                />
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              This change requires a sign-in within the last five minutes.
            </p>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <Button
                type="submit"
                variant={change === "enable" ? "default" : "destructive"}
                disabled={
                  busy ||
                  ((change === "remove" || change === "replace") &&
                    confirmation !== product.name)
                }
              >
                {pending ? "Saving change…" : actionLabel}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
