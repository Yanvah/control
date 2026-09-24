import "server-only";
import { eq } from "drizzle-orm";
import { getDatabase, getSqlite } from "@/db/client";
import { authThrottle } from "@/db/schema";
import { RequestError } from "./request";

// This single-owner instance uses durable global buckets, so forged proxy headers
// cannot reset the attempt budget. No untrusted address becomes a database key.
export function enforceRateLimit(
  bucket:
    | "setup"
    | "login"
    | "auth"
    | "security"
    | "product-test"
    | "product-write"
    | "user-read"
    | "operation"
    | "audit-read"
    | "audit-verify",
  limit: number,
): void {
  const db = getDatabase();
  const allowed = getSqlite()
    .transaction(() => {
      const now = Date.now();
      const record = db
        .select()
        .from(authThrottle)
        .where(eq(authThrottle.key, bucket))
        .get();
      if (!record || now - record.windowStartedAt >= 60_000) {
        db.insert(authThrottle)
          .values({ key: bucket, count: 1, windowStartedAt: now })
          .onConflictDoUpdate({
            target: authThrottle.key,
            set: { count: 1, windowStartedAt: now },
          })
          .run();
        return true;
      }
      if (record.count >= limit) return false;
      db.update(authThrottle)
        .set({ count: record.count + 1 })
        .where(eq(authThrottle.key, bucket))
        .run();
      return true;
    })
    .immediate();
  if (!allowed) throw new RequestError(429, "TOO_MANY_ATTEMPTS");
}
