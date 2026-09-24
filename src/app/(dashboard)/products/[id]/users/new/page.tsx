import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/server";
import { getProduct } from "@/lib/products/service";
import { productIdSchema } from "@/lib/products/input";
import { getUserDetail } from "@/lib/users/service";
import { CreateUserForm } from "@/components/users/create-user-form";
import { ReadProblem } from "@/components/users/presentation";

export const metadata: Metadata = { title: "Create user" };

export default async function CreateUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const owner = await requireOwner();
  const id = productIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const product = getProduct(id.data);
  if (!product) notFound();
  const detail = await getUserDetail(product.id, undefined, {
    id: owner.user.id,
    email: owner.user.email,
  });
  const supported =
    product.enabled &&
    detail.capabilities?.operations.includes("users.create") &&
    detail.capabilityVersion;
  return (
    <div className="max-w-2xl space-y-7">
      <Link className="text-xs text-primary" href={`/products/${product.id}`}>
        ← {product.name}
      </Link>
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">
          Create user
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Create an account in {product.name}. The product controls invitations,
          credentials, and account defaults.
        </p>
      </div>
      {supported ? (
        <CreateUserForm
          product={{ id: product.id, name: product.name }}
          capabilityVersion={detail.capabilityVersion!}
          canInspect={
            detail.capabilities?.operations.includes("users.get") ?? false
          }
        />
      ) : (
        <div className="space-y-3 rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-medium">Creation unavailable</h2>
          {!product.enabled ? (
            <p className="text-xs text-muted-foreground">
              This product is disabled.
            </p>
          ) : !detail.capabilities ? (
            <ReadProblem
              result={
                detail.user.state === "ready"
                  ? { state: "failed", code: "INVALID_RESPONSE" }
                  : detail.user
              }
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              This product does not currently advertise user creation. Reconnect
              it after updating its SDK handler.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
