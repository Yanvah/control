import { operationInputSchemas } from "@yanvah/control";
import { requireApiOwner } from "@/lib/auth/server";
import { productIdSchema } from "@/lib/products/input";
import { getUserDetail } from "@/lib/users/service";
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
  try {
    requireSameOrigin(request);
    const owner = await requireApiOwner(request);
    const id = productIdSchema.safeParse((await context.params).id);
    if (!id.success) throw new RequestError(404, "PRODUCT_NOT_FOUND");
    const input = await readJson(
      request,
      operationInputSchemas["users.get"].partial(),
    );
    return jsonResponse(
      await getUserDetail(
        id.data,
        input.userId,
        { id: owner.user.id, email: owner.user.email },
        request.signal,
      ),
    );
  } catch (error) {
    return requestErrorResponse(error);
  }
}
