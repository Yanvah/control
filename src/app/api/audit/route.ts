import { requireApiOwner } from "@/lib/auth/server";
import { listAuditEvents, parseAuditFilters } from "@/lib/audit/query";
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
    enforceRateLimit("audit-read", 60);
    return jsonResponse(
      listAuditEvents(
        parseAuditFilters(
          Object.fromEntries(new URL(request.url).searchParams),
        ),
      ),
    );
  } catch (error) {
    return requestErrorResponse(error);
  }
}
