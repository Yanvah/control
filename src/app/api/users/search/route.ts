import { auditedRequest, beginAudit } from "@/lib/audit/context";
import { requireApiOwner } from "@/lib/auth/server";
import { searchInputSchema } from "@/lib/users/models";
import { searchUsers } from "@/lib/users/service";
import { beginSearch } from "@/lib/users/searches";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  jsonResponse,
  readJson,
  requestErrorResponse,
  requireSameOrigin,
} from "@/lib/security/request";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  return auditedRequest("users.search", async () => {
    try {
      requireSameOrigin(request);
      const owner = await requireApiOwner(request);
      enforceRateLimit("user-read", 60);
      const input = await readJson(request, searchInputSchema);
      beginAudit();
      const search = beginSearch(
        owner.session.id,
        input.channelId,
        input.sequence,
        request.signal,
      );
      try {
        return jsonResponse({
          results: await searchUsers(
            input.query,
            { id: owner.user.id, email: owner.user.email },
            search.signal,
          ),
        });
      } finally {
        search.close();
      }
    } catch (error) {
      return requestErrorResponse(error);
    }
  });
}
