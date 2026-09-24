import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { operationInputSchemas } from "@yanvah/control";
import { getUserDetail } from "@/lib/users/service";
import { requireOwner } from "@/lib/auth/server";
import { getProduct } from "@/lib/products/service";
import { productIdSchema } from "@/lib/products/input";
import { UserDetailView } from "@/components/users/user-detail";
export const metadata: Metadata = { title: "User details" };
export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ userId?: string | string[] }>;
}): Promise<React.JSX.Element> {
  const owner = await requireOwner();
  const id = productIdSchema.safeParse((await params).productId);
  const input = operationInputSchemas["users.get"].safeParse({
    userId: (await searchParams).userId,
  });
  if (!id.success || !input.success) notFound();
  const product = getProduct(id.data);
  if (!product) notFound();
  const detail = await getUserDetail(product.id, input.data.userId, {
    id: owner.user.id,
    email: owner.user.email,
  });
  return (
    <UserDetailView
      initialDetail={detail}
      key={`${product.id}:${input.data.userId}`}
      product={{ id: product.id, name: product.name }}
      userId={input.data.userId}
    />
  );
}
