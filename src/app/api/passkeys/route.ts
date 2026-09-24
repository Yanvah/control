import { listOwnerPasskeys } from "@/lib/auth/management";
import { requireApiOwner } from "@/lib/auth/server";
import { jsonResponse, requestErrorResponse } from "@/lib/security/request";

export const runtime = "nodejs";
export async function GET(request: Request): Promise<Response> {
  try {
    const owner = await requireApiOwner(request);
    return jsonResponse({ passkeys: listOwnerPasskeys(owner.user.id) });
  } catch (error) {
    return requestErrorResponse(error);
  }
}
