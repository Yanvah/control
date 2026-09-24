import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getUserDetail } from "@/lib/users/service";
import { requireOwner } from "@/lib/auth/server";
import { getProduct } from "@/lib/products/service";
import { productIdSchema } from "@/lib/products/input";
import { UserDetailView } from "@/components/users/user-detail";
export const metadata: Metadata = { title: "Product actions" };
export default async function ProductActionsPage({
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
  return (
    <UserDetailView
      initialDetail={detail}
      key={product.id}
      product={{ id: product.id, name: product.name }}
    />
  );
}
