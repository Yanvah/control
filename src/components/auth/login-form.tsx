"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormMessage } from "@/components/auth/form-message";
import type { LoginDestination } from "@/lib/auth/destination";
import { authClient } from "@/lib/auth/client";

export function LoginForm({
  destination,
  reauthenticate,
}: {
  destination: LoginDestination;
  reauthenticate: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<"password" | "passkey" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    setError(null);
    setPending("password");
    try {
      const result = await authClient.signIn.email({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      if (result.error) {
        setError(
          result.error.status === 429
            ? "Too many attempts. Wait a moment before signing in again."
            : "Sign-in failed. Check your email and password.",
        );
        return;
      }
      router.replace(destination);
      router.refresh();
    } catch {
      setError("Could not sign in. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  async function signInWithPasskey(): Promise<void> {
    if (pending) return;
    setError(null);
    setPending("passkey");
    try {
      const result = await authClient.signIn.passkey();
      if (result.error) {
        setError(
          "Passkey sign-in did not complete. Try again or use your password.",
        );
        return;
      }
      router.replace(destination);
      router.refresh();
    } catch {
      setError(
        "Passkey sign-in did not complete. Try again or use your password.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {reauthenticate ? "Confirm it’s you" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {reauthenticate
            ? "Sign in again to confirm sensitive changes to your instance."
            : "Sign in to Yanvah Control."}
        </p>
      </div>
      <form onSubmit={(event) => void signIn(event)} className="space-y-5">
        <fieldset disabled={pending !== null} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username webauthn"
              maxLength={254}
              required
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              required
            />
          </div>
        </fieldset>
        <FormMessage message={error} />
        <Button type="submit" disabled={pending !== null} className="w-full">
          {pending === "password" ? "Signing in…" : "Sign in"}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </form>
      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[10px] text-muted-foreground">OR</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button
        variant="outline"
        disabled={pending !== null}
        onClick={() => void signInWithPasskey()}
        className="w-full"
      >
        <Fingerprint className="size-4" aria-hidden="true" />
        {pending === "passkey"
          ? "Waiting for your passkey…"
          : "Sign in with a passkey"}
      </Button>
    </>
  );
}
