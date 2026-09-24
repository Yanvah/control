import { auditedRequest, describeAudit } from "@/lib/audit/context";
import { requireApiOwner } from "@/lib/auth/server";
import { productIdSchema } from "@/lib/products/input";
import { mutationRequestSchema } from "@/lib/users/models";
import { executeOperation } from "@/lib/operations/service";
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
  return auditedRequest("operation.submit", async () => {
    try {
      requireSameOrigin(request);
      const owner = await requireApiOwner(request, true);
      enforceRateLimit("operation", 30);
      const id = productIdSchema.safeParse((await context.params).id);
      if (!id.success) throw new RequestError(404, "PRODUCT_NOT_FOUND");
      describeAudit({ productId: id.data });
      const input = await readJson(request, mutationRequestSchema);
      describeAudit({
        action: input.operation,
        attemptId: input.attemptId,
        targetType: input.operation === "actions.invoke" ? "action" : "user",
        targetId:
          input.operation === "actions.invoke"
            ? input.input.actionId
            : input.operation === "users.create"
              ? input.input.email
              : input.input.userId,
      });
      return jsonResponse(
        await executeOperation(id.data, input, {
          id: owner.user.id,
          email: owner.user.email,
        }),
      );
    } catch (error) {
      return requestErrorResponse(error);
    }
  });
}
