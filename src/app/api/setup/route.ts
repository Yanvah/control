import { auditedRequest, beginAudit } from "@/lib/audit/context";
import { claimInstance, setupSchema } from "@/lib/auth/setup";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  jsonResponse,
  readJson,
  requestErrorResponse,
  requireSameOrigin,
} from "@/lib/security/request";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return auditedRequest("setup.claim", async () => {
    try {
      requireSameOrigin(request);
      enforceRateLimit("setup", 10);
      beginAudit();
      await claimInstance(await readJson(request, setupSchema));
      return jsonResponse({ ok: true }, 201);
    } catch (error) {
      return requestErrorResponse(error);
    }
  });
}
