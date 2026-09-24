import { auditedRequest, beginAudit, auditOutcome } from "@/lib/audit/context";
import { requireApiOwner } from "@/lib/auth/server";
import { productIdSchema, testProductSchema } from "@/lib/products/input";
import { testProductConnection } from "@/lib/products/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  RequestError,
  jsonResponse,
  readJson,
  requestErrorResponse,
  requireSameOrigin,
} from "@/lib/security/request";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return auditedRequest("product.test", async () => {
    try {
      requireSameOrigin(request);
      await requireApiOwner(request);
      enforceRateLimit("product-test", 30);
      const id = productIdSchema.safeParse((await context.params).id);
      if (!id.success) throw new RequestError(404, "PRODUCT_NOT_FOUND");
      await readJson(request, testProductSchema);
      beginAudit({ action: "product.test", productId: id.data });
      const product = await testProductConnection(id.data);
      auditOutcome(
        product.status === "online" ? "succeeded" : "failed",
        product.lastErrorCode,
      );
      return jsonResponse({ product });
    } catch (error) {
      return requestErrorResponse(error);
    }
  });
}
