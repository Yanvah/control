import { Brand } from "@/components/layout/brand";
import { Navigation } from "@/components/layout/navigation";
import { CommandMenu } from "@/components/layout/command-menu";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireOwner } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): Promise<React.JSX.Element> {
  const { user } = await requireOwner();

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[222px_minmax(0,1fr)]">
      <a
        href="#main-content"
        className="sr-only fixed top-3 left-3 z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only"
      >
        Skip to content
      </a>
      <aside className="flex flex-col border-b border-border bg-sidebar md:sticky md:top-0 md:h-dvh md:border-r md:border-b-0">
        <div className="flex h-17 items-center border-b border-border px-5">
          <Brand />
        </div>
        <Navigation />
        <div className="mt-auto hidden border-t border-border p-3 md:block">
          <div className="mb-2 flex items-center gap-2.5 px-2 py-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-xs font-semibold uppercase">
              {user.name.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{user.name}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Instance owner
              </p>
            </div>
          </div>
          <SignOutButton />
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex h-17 items-center justify-end border-b border-border px-6 lg:px-9">
          <CommandMenu />
        </header>
        <main
          id="main-content"
          className="mx-auto max-w-6xl px-6 pt-4 pb-6 lg:px-9 lg:pt-7 lg:pb-9"
        >
          {children}
        </main>
        <div className="border-t border-border px-6 py-3 md:hidden">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
