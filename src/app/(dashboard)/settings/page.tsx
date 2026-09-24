import type { Metadata } from "next";
import { ShieldCheck, UserRound } from "lucide-react";
import { SecuritySettings } from "@/components/auth/security-settings";
import { SettingsWelcomeToast } from "@/components/auth/settings-welcome-toast";
import { requireOwner } from "@/lib/auth/server";
import { listOwnerPasskeys, listOwnerSessions } from "@/lib/auth/management";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage(): Promise<React.JSX.Element> {
  const { user, session } = await requireOwner();
  const passkeys = listOwnerPasskeys(user.id);
  const sessions = listOwnerSessions(user.id, session.id);

  return (
    <div>
      <h1 className="text-[28px] font-semibold tracking-tight">Settings</h1>
      <p className="text-sm text-muted-foreground">
        Manage your owner account and access to this instance.
      </p>
      <SettingsWelcomeToast />
      <section
        aria-labelledby="owner-heading"
        className="mt-8 rounded-lg border border-border bg-card mb-8"
      >
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <UserRound className="size-4 text-primary" aria-hidden="true" />
          <h2 id="owner-heading" className="text-sm font-semibold">
            Owner profile
          </h2>
        </div>
        <dl className="grid gap-5 px-5 py-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Name</dt>
            <dd className="mt-1.5 break-words text-sm">{user.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd className="mt-1.5 break-all text-sm">{user.email}</dd>
          </div>
        </dl>
      </section>
      <SecuritySettings passkeys={passkeys} sessions={sessions} />
      <p className="mt-7 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Security changes require a sign-in within the last five minutes. All
        times are shown in UTC.
      </p>
    </div>
  );
}
