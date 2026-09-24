"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Boxes,
  LayoutDashboard,
  Search,
  ScrollText,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const destinations = [
  {
    href: "/audit",
    label: "Audit Log",
    detail: "Actions, outcomes, and security events",
    icon: ScrollText,
  },
  {
    href: "/users",
    label: "Users",
    detail: "Search accounts and run supported operations",
    icon: Search,
  },
  {
    href: "/products",
    label: "Products",
    detail: "Connections, credentials, and capabilities",
    icon: Boxes,
  },
  {
    href: "/overview",
    label: "Overview",
    detail: "Product connections and account security",
    icon: LayoutDashboard,
  },
  {
    href: "/settings",
    label: "Settings",
    detail: "Owner, passkeys, and active sessions",
    icon: Settings2,
  },
];

export function CommandMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const filtered = destinations.filter((item) =>
    `${item.label} ${item.detail}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setQuery("");
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open page navigation"
          className="gap-2 text-muted-foreground"
        >
          <Search className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Go to…</span>
          <kbd className="hidden rounded border px-1.5 py-0.5 font-mono text-[10px] md:inline">
            ⌘ / Ctrl K
          </kbd>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Go to a page</DialogTitle>
          <DialogDescription>Navigate your Control instance.</DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Find a page"
          placeholder="Find a page…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="space-y-1">
          {filtered.map(({ href, label, detail, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-md px-3 py-3 hover:bg-secondary"
            >
              <Icon className="size-4 text-primary" aria-hidden="true" />
              <span className="flex-1">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">
                  {detail}
                </span>
              </span>
              <ArrowUpRight
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
            </Link>
          ))}
          {filtered.length === 0 && (
            <p className="py-5 text-center text-sm text-muted-foreground">
              No matching pages.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
