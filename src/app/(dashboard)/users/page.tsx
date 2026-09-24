import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth/server";
import { UserSearch } from "@/components/users/user-search";
export const metadata: Metadata = { title: "Users" };
export default async function UsersPage(): Promise<React.JSX.Element> {
  await requireOwner();
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">
          Search users across products
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Find an account by email, name, or user ID, then inspect its state and
          available operations.
        </p>
      </div>
      <UserSearch />
    </div>
  );
}
