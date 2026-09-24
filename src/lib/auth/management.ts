import "server-only";
import { and, desc, eq, gt } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { passkey, session } from "@/db/schema";
import { RequestError } from "@/lib/security/request";

export type OwnerSessionView = {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  current: boolean;
};
export type OwnerPasskeyView = {
  id: string;
  name: string | null;
  createdAt: Date | null;
  deviceType: string;
  backedUp: boolean;
};

export function listOwnerSessions(
  userId: string,
  currentSessionId: string,
): OwnerSessionView[] {
  return getDatabase()
    .select({
      id: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
    })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date())))
    .orderBy(desc(session.createdAt))
    .all()
    .map((record) => ({ ...record, current: record.id === currentSessionId }));
}

export function listOwnerPasskeys(userId: string): OwnerPasskeyView[] {
  return getDatabase()
    .select({
      id: passkey.id,
      name: passkey.name,
      createdAt: passkey.createdAt,
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
    })
    .from(passkey)
    .where(eq(passkey.userId, userId))
    .orderBy(desc(passkey.createdAt))
    .all();
}

export function revokeOwnerSession(
  userId: string,
  currentSessionId: string,
  sessionId: string,
): void {
  if (sessionId === currentSessionId)
    throw new RequestError(400, "USE_SIGN_OUT");
  const result = getDatabase()
    .delete(session)
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
    .run();
  if (result.changes === 0) throw new RequestError(404, "SESSION_NOT_FOUND");
}

export function revokeOwnerPasskey(userId: string, passkeyId: string): void {
  const result = getDatabase()
    .delete(passkey)
    .where(and(eq(passkey.id, passkeyId), eq(passkey.userId, userId)))
    .run();
  if (result.changes === 0) throw new RequestError(404, "PASSKEY_NOT_FOUND");
}
