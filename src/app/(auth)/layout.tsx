import { Brand } from "@/components/layout/brand";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex h-17 items-center border-b border-border px-6 lg:px-9">
        <Brand />
      </header>
      <section className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </main>
  );
}
