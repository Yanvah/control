import { requireApiOwner } from "@/lib/auth/server";
import { auditEventSequence } from "@/lib/audit/query";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  jsonResponse,
  requestErrorResponse,
  requireSameOriginRead,
} from "@/lib/security/request";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    requireSameOriginRead(request);
    await requireApiOwner(request);
    enforceRateLimit("audit-read", 60);
    return jsonResponse({
      events: auditEventSequence((await context.params).id),
    });
  } catch (error) {
    return requestErrorResponse(error);
  }
}
