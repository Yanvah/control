"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormMessage } from "@/components/auth/form-message";
import { authClient } from "@/lib/auth/client";

async function setupErrorMessage(response: Response): Promise<string> {
  let code: unknown;
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      code = body.error;
    }
  } catch {
    // Fall back to the status-based message when the response is not JSON.
  }

  if (code === "INVALID_ORIGIN") {
    return "This page is not using the configured CONTROL_URL. Open Control at that exact address and try again.";
  }
  if (code === "INVALID_SETUP_TOKEN") {
    return "The setup token does not match the token configured for this instance.";
  }
  if (code === "INVALID_REQUEST") {
    return "Check your name, email, and password. Passwords must contain 12–128 characters.";
  }
  if (code === "SETUP_UNAVAILABLE") {
    return "First-run setup is unavailable. Configure CONTROL_SETUP_TOKEN and restart Control.";
  }
  if (response.status === 409) {
    return "This instance has already been claimed. Sign in with the owner account.";
  }
  if (response.status === 429) {
    return "Too many setup attempts. Wait a moment before trying again.";
  }
  return "Setup could not be completed. Check your setup token and account details.";
}

export function SetupForm(): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const setupToken = String(form.get("setupToken") ?? "");
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, setupToken }),
      });
      if (!response.ok) {
        setError(await setupErrorMessage(response));
        return;
      }
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError("Your owner account was created. Sign in to continue.");
        return;
      }
      router.replace("/settings?welcome=1");
      router.refresh();
    } catch {
      setError(
        "Could not confirm setup. Check your connection. If the account was created, sign in to continue.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">
          Claim your instance
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Create the owner account for this instance. Setup closes after this
          step.
        </p>
      </div>
      <form onSubmit={(event) => void submit(event)} className="space-y-5">
        <fieldset disabled={pending} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              maxLength={100}
              required
              placeholder="Your name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
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
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              aria-describedby="password-hint"
            />
            <p id="password-hint" className="text-xs text-muted-foreground">
              Use at least 12 characters. A password manager is recommended.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="setup-token">Setup token</Label>
            <Input
              id="setup-token"
              name="setupToken"
              type="password"
              autoComplete="off"
              maxLength={512}
              required
              aria-describedby="setup-token-hint"
            />
            <p
              id="setup-token-hint"
              className="text-xs leading-5 text-muted-foreground"
            >
              The{" "}
              <code className="text-[11px] text-foreground/80">
                CONTROL_SETUP_TOKEN
              </code>{" "}
              configured by your instance administrator.
            </p>
          </div>
        </fieldset>
        <FormMessage message={error} />
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Creating owner account…" : "Create owner account"}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </form>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Already claimed this instance?{" "}
        <Link
          href="/login"
          className="text-foreground underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
