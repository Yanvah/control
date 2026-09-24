"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";

export function SignOutButton(): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function signOut(): Promise<void> {
    setPending(true);
    setError(false);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError(true);
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void signOut()}
        disabled={pending}
        className="w-full justify-start gap-2 text-muted-foreground"
      >
        <LogOut className="size-4" aria-hidden="true" />
        {pending ? "Signing out…" : "Sign out"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          Could not sign out. Try again.
        </p>
      )}
    </div>
  );
}
