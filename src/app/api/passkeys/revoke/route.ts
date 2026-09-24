import { auditedRequest, beginAudit } from "@/lib/audit/context";
import { z } from "zod";
import { revokeOwnerPasskey } from "@/lib/auth/management";
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
  return auditedRequest("passkey.revoke", async () => {
    try {
      requireSameOrigin(request);
      const owner = await requireApiOwner(request, true);
      enforceRateLimit("security", 30);
      const { passkeyId } = await readJson(
        request,
        z.object({ passkeyId: z.string().min(1).max(128) }).strict(),
      );
      beginAudit({
        action: "passkey.revoke",
        targetType: "passkey",
        targetId: passkeyId,
      });
      revokeOwnerPasskey(owner.user.id, passkeyId);
      return jsonResponse({ ok: true });
    } catch (error) {
      return requestErrorResponse(error);
    }
  });
}
