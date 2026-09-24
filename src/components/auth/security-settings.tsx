"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint, KeyRound, Laptop, Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { useToast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth/client";
import type { OwnerPasskeyView, OwnerSessionView } from "@/lib/auth/management";

type Removal = { kind: "session" | "passkey"; id: string; name: string };

function formatDate(date: Date | null): string {
  if (!date) return "Date unavailable";
  return `${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(date))} UTC`;
}

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Browser information unavailable";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const platform = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Macintosh/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "Unknown device";
  return `${browser} · ${platform}`;
}

export function SecuritySettings({
  passkeys,
  sessions,
}: {
  passkeys: OwnerPasskeyView[];
  sessions: OwnerSessionView[];
}): React.JSX.Element {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [name, setName] = useState("");
  const [removal, setRemoval] = useState<Removal | null>(null);
  const busy = pending || refreshing;

  function refresh(): void {
    startRefresh(() => router.refresh());
  }

  async function addPasskey(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setPending(true);
    try {
      const result = await authClient.passkey.addPasskey({
        name: name.trim() || "My passkey",
      });
      if (result.error) {
        toast({
          title: "Could not confirm passkey enrollment",
          description:
            "Refresh the page to check your passkeys before trying again. Sign in again if your session is no longer recent.",
          variant: "error",
          action: {
            label: "Sign in again",
            href: "/login?reauth=1&next=/settings",
          },
          duration: 8_000,
        });
        return;
      }
      setName("");
      toast({
        title: "Passkey added",
        description: "You can now use it to sign in.",
        variant: "success",
      });
      refresh();
    } catch {
      toast({
        title: "Could not confirm passkey enrollment",
        description:
          "Refresh the page to check your passkeys before trying again.",
        variant: "error",
      });
    } finally {
      setPending(false);
    }
  }

  async function confirmRemoval(): Promise<void> {
    if (!removal || busy) return;
    setPending(true);
    try {
      const response = await fetch(
        removal.kind === "session"
          ? "/api/sessions/revoke"
          : "/api/passkeys/revoke",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            removal.kind === "session"
              ? { sessionId: removal.id }
              : { passkeyId: removal.id },
          ),
        },
      );
      if (!response.ok) {
        // The change may have committed before its audit completion failed.
        if (response.status >= 500) {
          toast({
            title: "Could not confirm the change",
            description:
              "Refresh the page to check the current state before trying again.",
            variant: "error",
          });
          return;
        }
        const result = z
          .object({ error: z.string() })
          .safeParse(await response.json());
        if (
          result.success &&
          result.data.error === "RECENT_AUTHENTICATION_REQUIRED"
        ) {
          toast({
            title: "Recent sign-in required",
            description:
              "Confirm your identity before changing account security.",
            variant: "error",
            action: {
              label: "Sign in again",
              href: "/login?reauth=1&next=/settings",
            },
            duration: 8_000,
          });
        } else if (response.status === 401) {
          toast({
            title: "Your session has ended",
            description: "Sign in again to continue.",
            variant: "error",
            action: {
              label: "Sign in again",
              href: "/login?reauth=1&next=/settings",
            },
            duration: 8_000,
          });
        } else {
          toast({
            title: "Change was not completed",
            description: "Refresh the page and try again.",
            variant: "error",
          });
        }
        return;
      }
      toast({
        title:
          removal.kind === "session" ? "Session revoked" : "Passkey removed",
        description:
          removal.kind === "session"
            ? "That browser is now signed out."
            : "It can no longer sign in to this instance.",
        variant: "success",
      });
      refresh();
    } catch {
      toast({
        title: "Could not confirm the change",
        description: "Refresh the page to check the current state.",
        variant: "error",
      });
    } finally {
      setPending(false);
      setRemoval(null);
    }
  }

  return (
    <div className="space-y-8">
      <section
        aria-labelledby="passkeys-heading"
        className="rounded-lg border border-border bg-card"
      >
        <div className="border-b border-border px-5 py-5">
          <div className="flex items-center gap-2">
            <Fingerprint className="size-4 text-primary" aria-hidden="true" />
            <h2 id="passkeys-heading" className="text-sm font-semibold">
              Passkeys
            </h2>
            <Badge
              variant="secondary"
              className="ml-auto font-mono text-[10px]"
            >
              {passkeys.length}
            </Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Sign in with your fingerprint, device PIN, or a security key. Your
            private key stays with your authenticator.
          </p>
        </div>
        {passkeys.length === 0 ? (
          <div className="flex items-start gap-3 px-5 py-5">
            <KeyRound
              className="mt-0.5 size-5 text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm">Add your first passkey</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                A more convenient way to sign in, with protection against
                phishing.
              </p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {passkeys.map((passkey) => (
              <li
                key={passkey.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <KeyRound
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">
                      {passkey.name || "Passkey"}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Added {formatDate(passkey.createdAt)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`Remove ${passkey.name || "passkey"}`}
                  onClick={() =>
                    setRemoval({
                      kind: "passkey",
                      id: passkey.id,
                      name: passkey.name || "Passkey",
                    })
                  }
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={(event) => void addPasskey(event)}
          className="border-t border-border px-5 py-4"
        >
          <Label htmlFor="passkey-name" className="text-xs">
            Passkey name
          </Label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input
              id="passkey-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              placeholder="For example, my laptop"
              disabled={busy}
              className="sm:max-w-xs"
            />
            <Button type="submit" variant="outline" disabled={busy}>
              <Plus className="size-4" aria-hidden="true" />
              {pending && !removal ? "Waiting for your device…" : "Add passkey"}
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            Enrollment requires a recent sign-in and a browser that supports
            passkeys.
          </p>
        </form>
      </section>

      <section
        aria-labelledby="sessions-heading"
        className="rounded-lg border border-border bg-card"
      >
        <div className="border-b border-border px-5 py-5">
          <div className="flex items-center gap-2">
            <Laptop className="size-4 text-primary" aria-hidden="true" />
            <h2 id="sessions-heading" className="text-sm font-semibold">
              Active sessions
            </h2>
            <Badge
              variant="secondary"
              className="ml-auto font-mono text-[10px]"
            >
              {sessions.length}
            </Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Browsers currently signed in to your instance. Revoke a session to
            end its access immediately.
          </p>
        </div>
        <ul className="divide-y divide-border">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-5"
            >
              <div className="flex min-w-0 gap-3">
                <Laptop
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">
                      {deviceLabel(session.userAgent)}
                    </p>
                    {session.current && (
                      <Badge
                        variant="outline"
                        className="border-primary/20 text-[10px] text-primary"
                      >
                        This session
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                    Signed in {formatDate(session.createdAt)}
                    <br />
                    Expires {formatDate(session.expiresAt)}
                    {session.ipAddress && (
                      <>
                        <br />
                        <span className="font-mono">{session.ipAddress}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>
              {!session.current && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    setRemoval({
                      kind: "session",
                      id: session.id,
                      name: deviceLabel(session.userAgent),
                    })
                  }
                >
                  Revoke session
                </Button>
              )}
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-5 py-3 text-[11px] leading-5 text-muted-foreground">
          Use Sign out to end this session. Device names are based on
          browser-reported information.
        </p>
      </section>

      <AlertDialog
        open={removal !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setRemoval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removal?.kind === "session"
                ? "Revoke this session?"
                : "Remove this passkey?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removal?.kind === "session"
                ? `The session for ${removal.name} will be signed out immediately. It will need to sign in again to access this instance.`
                : `“${removal?.name ?? "Passkey"}” will no longer be able to sign in. Your password and other passkeys will continue to work.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => void confirmRemoval()}
            >
              {pending
                ? "Confirming…"
                : removal?.kind === "session"
                  ? "Revoke session"
                  : "Remove passkey"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
