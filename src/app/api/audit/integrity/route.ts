import { requireApiOwner } from "@/lib/auth/server";
import { verifyAuditChain } from "@/lib/audit/store";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  jsonResponse,
  requestErrorResponse,
  requireSameOriginRead,
} from "@/lib/security/request";
export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  try {
    requireSameOriginRead(request);
    await requireApiOwner(request);
    enforceRateLimit("audit-verify", 5);
    return jsonResponse(verifyAuditChain());
  } catch (error) {
    return requestErrorResponse(error);
  }
}
