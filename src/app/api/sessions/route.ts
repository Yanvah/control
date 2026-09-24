import { listOwnerSessions } from "@/lib/auth/management";
import { requireApiOwner } from "@/lib/auth/server";
import { jsonResponse, requestErrorResponse } from "@/lib/security/request";

export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  try {
    const owner = await requireApiOwner(request);
    return jsonResponse({
      sessions: listOwnerSessions(owner.user.id, owner.session.id),
    });
  } catch (error) {
    return requestErrorResponse(error);
  }
}
