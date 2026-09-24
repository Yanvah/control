"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  operationInputSchemas,
  operationResultSchemas,
  type User,
} from "@yanvah/control";
import { z } from "zod";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  mutationRequestSchema,
  mutationResultSchema,
  userDetailPath,
  type MutationResult,
  type ProductSummary,
} from "@/lib/users/models";
import { operationMessage } from "./presentation";

export function CreateUserForm({
  product,
  capabilityVersion,
  canInspect,
}: {
  product: ProductSummary;
  capabilityVersion: string;
  canInspect: boolean;
}): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MutationResult | null>(null);
  const [createdUser, setCreatedUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reauthenticate, setReauthenticate] = useState(false);
  const submitting = useRef(false);
  const destination = `/products/${product.id}/users/new`;

  function review(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = operationInputSchemas["users.create"].safeParse({
      email,
      ...(name.trim() ? { name } : {}),
    });
    if (!parsed.success) {
      setError("Enter a valid email and a name of at most 200 characters.");
      return;
    }
    setError(null);
    setAcknowledged(false);
    setConfirming(true);
  }

  function acceptOutcome(outcome: MutationResult): void {
    setResult(outcome);
    if (outcome.state === "succeeded" && outcome.output !== undefined) {
      const created = operationResultSchemas["users.create"].safeParse(
        outcome.output,
      );
      if (created.success) setCreatedUser(created.data.user);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!acknowledged || pending || submitting.current) return;
    const attemptId = crypto.randomUUID();
    const parsed = mutationRequestSchema.safeParse({
      operation: "users.create",
      attemptId,
      capabilityVersion,
      confirmed: true,
      confirmation: "",
      input: { email, ...(name.trim() ? { name } : {}) },
    });
    if (!parsed.success) {
      setError("Check the email and name before continuing.");
      return;
    }
    submitting.current = true;
    setPending(true);
    setConfirming(false);
    setResult(null);
    setCreatedUser(null);
    setError(null);
    setReauthenticate(false);
    try {
      const response = await fetch(`/api/products/${product.id}/operations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const problem = z.object({ error: z.string() }).safeParse(payload);
        const code = problem.success ? problem.data.error : null;
        if (response.status >= 500) {
          acceptOutcome({ attemptId, state: "unknown", code, requestId: null });
        } else {
          setReauthenticate(
            response.status === 401 ||
              code === "RECENT_AUTHENTICATION_REQUIRED",
          );
          setError(operationMessage(code));
        }
        return;
      }
      acceptOutcome(mutationResultSchema.parse(payload));
    } catch {
      acceptOutcome({
        attemptId,
        state: "unknown",
        code: null,
        requestId: null,
      });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  async function checkOutcome(): Promise<void> {
    if (!result || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/operations/${result.attemptId}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        setError(
          "The recorded outcome could not be confirmed. Search the product before starting a new attempt.",
        );
        return;
      }
      acceptOutcome(mutationResultSchema.parse(await response.json()));
    } catch {
      setError("The recorded outcome could not be reached.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  function startAnother(): void {
    setEmail("");
    setName("");
    setResult(null);
    setCreatedUser(null);
    setError(null);
  }

  return (
    <div className="space-y-5">
      {!result && (
        <form
          onSubmit={review}
          className="space-y-5 rounded-lg border border-border bg-card p-5"
        >
          <div className="space-y-2">
            <Label htmlFor="new-user-email">Email</Label>
            <Input
              id="new-user-email"
              type="email"
              autoComplete="off"
              maxLength={254}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-name">Name (optional)</Label>
            <Input
              id="new-user-name"
              autoComplete="off"
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={pending}
            />
          </div>
          <Button type="submit" disabled={pending}>
            Review creation
          </Button>
        </form>
      )}
      {pending && (
        <p role="status" className="text-sm text-muted-foreground">
          Waiting for the product. Do not submit again.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-300">
          {error}
        </p>
      )}
      {reauthenticate && (
        <Link
          className="text-sm text-primary underline"
          href={`/login?reauth=1&next=${encodeURIComponent(destination)}`}
        >
          Sign in again
        </Link>
      )}
      {result && (
        <section
          role="status"
          aria-live="polite"
          className="space-y-3 rounded-lg border border-border bg-card p-5"
        >
          <h2 className="font-medium">
            {result.state === "succeeded"
              ? "User created"
              : result.state === "failed"
                ? "Creation failed"
                : result.state === "pending"
                  ? "Creation still running"
                  : "Outcome unknown"}
          </h2>
          {result.state === "succeeded" ? (
            createdUser ? (
              <div className="space-y-2 text-sm">
                <p className="break-all">{createdUser.email ?? email}</p>
                <p className="break-all font-mono text-xs text-muted-foreground">
                  ID {createdUser.id}
                </p>
                {canInspect && (
                  <Link
                    className="text-primary underline"
                    href={userDetailPath(product.id, createdUser.id)}
                  >
                    View user
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                The product confirmed creation. Search for the user to inspect
                the record.
              </p>
            )
          ) : result.state === "failed" ? (
            <p className="text-sm text-muted-foreground">
              {operationMessage(result.code)}
            </p>
          ) : (
            <p className="text-sm text-amber-300">
              The product may have created this user. Check the recorded outcome
              and search the product before starting another attempt. Control
              has not retried it.
            </p>
          )}
          <p className="break-all font-mono text-[10px] text-muted-foreground">
            Attempt {result.attemptId}
            {result.requestId && <> · Request {result.requestId}</>}
          </p>
          {(result.state === "unknown" || result.state === "pending") && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void checkOutcome()}
            >
              Check recorded outcome
            </Button>
          )}
          <div className="flex flex-wrap gap-3 text-xs">
            <Link className="text-primary underline" href="/users">
              Search users
            </Link>
            {result.state !== "pending" && (
              <button
                type="button"
                className="text-primary underline"
                onClick={startAnother}
              >
                Start another attempt
              </button>
            )}
          </div>
        </section>
      )}
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirming(false);
        }}
      >
        <AlertDialogContent>
          <form onSubmit={(event) => void submit(event)} className="space-y-5">
            <AlertDialogHeader>
              <AlertDialogTitle>
                Create user in {product.name}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                The product will create this account using its own rules. It may
                send an invitation or other account email.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <dl className="space-y-2 rounded-md border border-border bg-secondary/30 p-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Product</dt>
                <dd className="break-words">{product.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="break-all">{email}</dd>
              </div>
              {name.trim() && (
                <div>
                  <dt className="text-muted-foreground">Name</dt>
                  <dd className="break-words">{name}</dd>
                </div>
              )}
            </dl>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-1"
              />
              I understand this creates an account in {product.name}.
            </label>
            <p className="text-xs text-muted-foreground">
              A sign-in within the last five minutes is required.
            </p>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <Button type="submit" disabled={!acknowledged || pending}>
                {pending ? "Creating…" : "Create user"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
