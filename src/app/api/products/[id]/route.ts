import { auditedRequest, beginAudit } from "@/lib/audit/context";
import { requireApiOwner } from "@/lib/auth/server";
import {
  productIdSchema,
  removeProductSchema,
  setProductEnabledSchema,
} from "@/lib/products/input";
import {
  getProduct,
  removeProduct,
  setProductEnabled,
} from "@/lib/products/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  RequestError,
  jsonResponse,
  readJson,
  requestErrorResponse,
  requireSameOrigin,
  requireSameOriginRead,
} from "@/lib/security/request";

export const runtime = "nodejs";
type ProductContext = { params: Promise<{ id: string }> };

async function productId(context: ProductContext): Promise<string> {
  const parsed = productIdSchema.safeParse((await context.params).id);
  if (!parsed.success) throw new RequestError(404, "PRODUCT_NOT_FOUND");
  return parsed.data;
}

export async function GET(
  request: Request,
  context: ProductContext,
): Promise<Response> {
  try {
    requireSameOriginRead(request);
    await requireApiOwner(request);
    const product = getProduct(await productId(context));
    if (!product) throw new RequestError(404, "PRODUCT_NOT_FOUND");
    return jsonResponse({ product });
  } catch (error) {
    return requestErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: ProductContext,
): Promise<Response> {
  return auditedRequest("product.update", async () => {
    try {
      requireSameOrigin(request);
      await requireApiOwner(request, true);
      enforceRateLimit("product-write", 30);
      const id = await productId(context);
      const { enabled } = await readJson(request, setProductEnabledSchema);
      beginAudit({
        action: enabled ? "product.enable" : "product.disable",
        productId: id,
        metadata: { enabled },
      });
      return jsonResponse({ product: setProductEnabled(id, enabled) });
    } catch (error) {
      return requestErrorResponse(error);
    }
  });
}

export async function DELETE(
  request: Request,
  context: ProductContext,
): Promise<Response> {
  return auditedRequest("product.remove", async () => {
    try {
      requireSameOrigin(request);
      await requireApiOwner(request, true);
      enforceRateLimit("product-write", 30);
      const id = await productId(context);
      const { confirmation } = await readJson(request, removeProductSchema);
      beginAudit({ action: "product.remove", productId: id });
      removeProduct(id, confirmation);
      return jsonResponse({ ok: true });
    } catch (error) {
      return requestErrorResponse(error);
    }
  });
}
