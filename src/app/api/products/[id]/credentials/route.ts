import { auditedRequest, beginAudit } from "@/lib/audit/context";
import { requireApiOwner } from "@/lib/auth/server";
import {
  productIdSchema,
  replaceProductCredentialsSchema,
} from "@/lib/products/input";
import { replaceProductCredentials } from "@/lib/products/service";
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
  return auditedRequest("product.credentials.replace", async () => {
    try {
      requireSameOrigin(request);
      await requireApiOwner(request, true);
      enforceRateLimit("product-write", 30);
      const id = productIdSchema.safeParse((await context.params).id);
      if (!id.success) throw new RequestError(404, "PRODUCT_NOT_FOUND");
      const { credentials, confirmation } = await readJson(
        request,
        replaceProductCredentialsSchema,
      );
      beginAudit({
        action: "product.credentials.replace",
        productId: id.data,
        metadata: { credentialMode: credentials.mode },
      });
      return jsonResponse(
        replaceProductCredentials(id.data, credentials, confirmation),
      );
    } catch (error) {
      return requestErrorResponse(error);
    }
  });
}
