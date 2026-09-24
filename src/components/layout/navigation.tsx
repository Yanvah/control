"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  LayoutDashboard,
  ScrollText,
  Settings2,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavigationItem = { label: string; icon: LucideIcon; href: string };

const items: NavigationItem[] = [
  { label: "Overview", icon: LayoutDashboard, href: "/overview" },
  { label: "Products", icon: Boxes, href: "/products" },
  { label: "Users", icon: UsersRound, href: "/users" },
  { label: "Audit Log", icon: ScrollText, href: "/audit" },
  { label: "Settings", icon: Settings2, href: "/settings" },
];

export function Navigation(): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary navigation"
      className="flex gap-1 overflow-x-auto px-3 py-3 md:block md:space-y-1 md:py-5"
    >
      {items.map(({ label, icon: Icon, href }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-3 rounded-md px-3 py-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
              active &&
                "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
