import { auditedRequest, beginAudit, describeAudit } from "@/lib/audit/context";
import { requireApiOwner } from "@/lib/auth/server";
import { registerProductSchema } from "@/lib/products/input";
import { listProducts, registerProduct } from "@/lib/products/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  jsonResponse,
  readJson,
  requestErrorResponse,
  requireSameOrigin,
  requireSameOriginRead,
} from "@/lib/security/request";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    requireSameOriginRead(request);
    await requireApiOwner(request);
    return jsonResponse({ products: listProducts() });
  } catch (error) {
    return requestErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  return auditedRequest("product.create", async () => {
    try {
      requireSameOrigin(request);
      await requireApiOwner(request, true);
      enforceRateLimit("product-write", 30);
      const input = await readJson(request, registerProductSchema);
      beginAudit({
        action: "product.create",
        metadata: { credentialMode: input.credentials.mode },
      });
      const result = await registerProduct(input);
      describeAudit({ productId: result.product.id });
      return jsonResponse(result, 201);
    } catch (error) {
      return requestErrorResponse(error);
    }
  });
}
