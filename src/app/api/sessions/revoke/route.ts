import { auditedRequest, beginAudit } from "@/lib/audit/context";
import { z } from "zod";
import { revokeOwnerSession } from "@/lib/auth/management";
import { requireApiOwner } from "@/lib/auth/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  jsonResponse,
  readJson,
  requestErrorResponse,
  requireSameOrigin,
} from "@/lib/security/request";

export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  return auditedRequest("session.revoke", async () => {
    try {
      requireSameOrigin(request);
      const owner = await requireApiOwner(request, true);
      enforceRateLimit("security", 30);
      const { sessionId } = await readJson(
        request,
        z.object({ sessionId: z.string().min(1).max(128) }).strict(),
      );
      beginAudit({
        action: "session.revoke",
        targetType: "session",
        targetId: sessionId,
      });
      revokeOwnerSession(owner.user.id, owner.session.id, sessionId);
      return jsonResponse({ ok: true });
    } catch (error) {
      return requestErrorResponse(error);
    }
  });
}
