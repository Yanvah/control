export const auditActions = [
  "setup.claim",
  "auth.login.password",
  "auth.login.passkey",
  "auth.signout",
  "auth.passkey.register",
  "auth.passkey.challenge",
  "auth.rejected",
  "session.revoke",
  "passkey.revoke",
  "product.create",
  "product.enable",
  "product.disable",
  "product.update",
  "product.credentials.replace",
  "product.remove",
  "product.test",
  "users.search",
  "users.create",
  "operation.submit",
  "operation.receipt",
  "users.ban",
  "users.unban",
  "users.revokeSessions",
  "subscriptions.changePlan",
  "actions.invoke",
] as const;
export type AuditAction = (typeof auditActions)[number];
export type AuditOutcome = "requested" | "succeeded" | "failed" | "unknown";
export type AuditTarget = "user" | "action" | "session" | "passkey";
export type AuditMetadata = {
  status?: number;
  enabled?: boolean;
  duplicate?: boolean;
  imported?: boolean;
  credentialMode?: "generate" | "existing";
  sdkRequestId?: string;
};
export type AuditDetails = {
  action: AuditAction;
  actorId?: string | null;
  productId?: string | null;
  attemptId?: string | null;
  targetType?: AuditTarget | null;
  targetId?: string | null;
  metadata?: AuditMetadata;
};
export type AuditEventView = {
  id: string;
  sequence: number;
  requestId: string;
  attemptId: string | null;
  actorId: string | null;
  productId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  eventType: AuditOutcome;
  safeCode: string | null;
  metadata: AuditMetadata;
  durationMs: number | null;
  createdAt: string;
  previousHash: string;
  integrityHash: string;
};
