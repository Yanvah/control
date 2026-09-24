import "server-only";
import { describeAudit } from "@/lib/audit/context";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDatabase, getSqlite } from "@/db/client";
import { account, instanceSettings, user } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { RequestError } from "@/lib/security/request";

export const setupSchema = z
  .object({
    setupToken: z.string().min(1).max(512),
    name: z.string().trim().min(1).max(100),
    email: z
      .email()
      .max(254)
      .transform((email) => email.toLowerCase()),
    password: z.string().min(12).max(128),
    instanceName: z.string().trim().min(1).max(100).default("Yanvah Control"),
  })
  .strict();
export type SetupInput = z.input<typeof setupSchema>;

export function isSetupComplete(): boolean {
  return (
    getDatabase()
      .select({ id: instanceSettings.id })
      .from(instanceSettings)
      .where(eq(instanceSettings.id, 1))
      .get() !== undefined
  );
}

export function assertSetupConfiguration(): void {
  const complete = isSetupComplete();
  const hasUser =
    getDatabase().select({ id: user.id }).from(user).get() !== undefined;
  if (complete !== hasUser)
    throw new Error(
      "Instance ownership state is inconsistent; restore a valid backup.",
    );
  if (!complete && !getEnv().CONTROL_SETUP_TOKEN)
    throw new Error(
      "CONTROL_SETUP_TOKEN is required for an unclaimed instance.",
    );
}

export async function claimInstance(input: SetupInput): Promise<void> {
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) throw new RequestError(400, "INVALID_REQUEST");
  if (isSetupComplete()) throw new RequestError(409, "SETUP_CLOSED");
  const configuredToken = getEnv().CONTROL_SETUP_TOKEN;
  if (!configuredToken) throw new RequestError(503, "SETUP_UNAVAILABLE");
  const digest = (value: string): Buffer =>
    createHash("sha256").update(value).digest();
  if (
    !timingSafeEqual(digest(parsed.data.setupToken), digest(configuredToken))
  ) {
    throw new RequestError(403, "INVALID_SETUP_TOKEN");
  }
  // Password hashing happens outside the lock; ownership is checked again inside
  // an immediate SQLite transaction before any account or setup marker is written.
  const passwordHash = await hashPassword(parsed.data.password);
  const db = getDatabase();
  getSqlite()
    .transaction(() => {
      if (isSetupComplete() || db.select({ id: user.id }).from(user).get()) {
        throw new RequestError(409, "SETUP_CLOSED");
      }
      const now = new Date();
      const ownerId = randomUUID();
      db.insert(user)
        .values({
          id: ownerId,
          name: parsed.data.name,
          email: parsed.data.email,
          emailVerified: false,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      db.insert(account)
        .values({
          id: randomUUID(),
          accountId: ownerId,
          providerId: "credential",
          userId: ownerId,
          password: passwordHash,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      describeAudit({ actorId: ownerId });
      db.insert(instanceSettings)
        .values({
          id: 1,
          ownerId,
          setupCompletedAt: now,
          instanceName: parsed.data.instanceName,
          createdAt: now,
        })
        .run();
    })
    .immediate();
}
