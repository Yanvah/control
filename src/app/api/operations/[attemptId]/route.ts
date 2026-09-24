import { z } from "zod";
import { requireApiOwner } from "@/lib/auth/server";
import { getOperationOutcome } from "@/lib/operations/service";
import {
  RequestError,
  jsonResponse,
  requestErrorResponse,
  requireSameOriginRead,
} from "@/lib/security/request";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ attemptId: string }> },
): Promise<Response> {
  try {
    requireSameOriginRead(request);
    const owner = await requireApiOwner(request);
    const id = z.uuid().safeParse((await context.params).attemptId);
    if (!id.success) throw new RequestError(404, "ATTEMPT_NOT_FOUND");
    return jsonResponse(getOperationOutcome(id.data, owner.user.id));
  } catch (error) {
    return requestErrorResponse(error);
  }
}
