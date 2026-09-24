import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
    image: text("image"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  () => [uniqueIndex("user_single_owner").on(sql`(1)`)],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const passkey = sqliteTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
    transports: text("transports"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    aaguid: text("aaguid"),
  },
  (table) => [
    index("passkey_user_id_idx").on(table.userId),
    uniqueIndex("passkey_credential_id_idx").on(table.credentialID),
  ],
);

export const instanceSettings = sqliteTable(
  "instance_settings",
  {
    id: integer("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    setupCompletedAt: integer("setup_completed_at", {
      mode: "timestamp_ms",
    }).notNull(),
    instanceName: text("instance_name").notNull(),
    securityVersion: integer("security_version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [check("instance_settings_singleton", sql`${table.id} = 1`)],
);

export const authThrottle = sqliteTable("auth_throttle", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStartedAt: integer("window_started_at").notNull(),
});

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    endpoint: text("endpoint").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    keyId: text("key_id").notNull(),
    encryptedSecret: text("encrypted_secret").notNull(),
    secretIv: text("secret_iv").notNull(),
    secretAuthTag: text("secret_auth_tag").notNull(),
    encryptionKeyVersion: integer("encryption_key_version").notNull(),
    secretFingerprint: text("secret_fingerprint").notNull(),
    revision: integer("revision").notNull().default(1),
    capabilitiesJson: text("capabilities_json"),
    lastConnectedAt: integer("last_connected_at", { mode: "timestamp_ms" }),
    lastTestedAt: integer("last_tested_at", { mode: "timestamp_ms" }),
    lastConnectionStatus: text("last_connection_status", {
      enum: ["unknown", "online", "offline", "degraded"],
    })
      .notNull()
      .default("unknown"),
    lastSafeErrorCode: text("last_safe_error_code"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("products_secret_fingerprint_idx").on(table.secretFingerprint),
    index("products_enabled_name_idx").on(table.enabled, table.name),
    check(
      "products_connection_status",
      sql`${table.lastConnectionStatus} IN ('unknown', 'online', 'offline', 'degraded')`,
    ),
    check(
      "products_encryption_key_version",
      sql`${table.encryptionKeyVersion} > 0`,
    ),
    check("products_revision", sql`${table.revision} > 0`),
  ],
);

// Remote-operation receipts are append-only. No parameters or remote
// response bodies are retained; the keyed digest binds duplicate attempts.
export const operationEvents = sqliteTable(
  "operation_events",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id").notNull(),
    actorId: text("actor_id").notNull(),
    productId: text("product_id").notNull(),
    operation: text("operation").notNull(),
    targetId: text("target_id").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    eventType: text("event_type", {
      enum: ["requested", "succeeded", "failed", "unknown"],
    }).notNull(),
    requestId: text("request_id"),
    safeCode: text("safe_code"),
    durationMs: integer("duration_ms"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("operation_events_attempt_type_idx").on(
      table.attemptId,
      table.eventType,
    ),
    uniqueIndex("operation_events_terminal_idx")
      .on(table.attemptId)
      .where(sql`${table.eventType} != 'requested'`),
    index("operation_events_product_created_idx").on(
      table.productId,
      table.createdAt,
    ),
    check(
      "operation_events_type",
      sql`${table.eventType} IN ('requested', 'succeeded', 'failed', 'unknown')`,
    ),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    requestId: text("request_id").notNull(),
    attemptId: text("attempt_id"),
    actorId: text("actor_id"),
    productId: text("product_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    eventType: text("event_type", {
      enum: ["requested", "succeeded", "failed", "unknown"],
    }).notNull(),
    safeCode: text("safe_code"),
    metadataJson: text("metadata_json").notNull(),
    durationMs: integer("duration_ms"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    previousHash: text("previous_hash").notNull(),
    integrityHash: text("integrity_hash").notNull(),
  },
  (table) => [
    uniqueIndex("audit_request_event_idx").on(table.requestId, table.eventType),
    uniqueIndex("audit_request_terminal_idx")
      .on(table.requestId)
      .where(sql`${table.eventType} != 'requested'`),
    index("audit_attempt_idx").on(table.attemptId),
    index("audit_product_time_idx").on(table.productId, table.createdAt),
    index("audit_action_time_idx").on(table.action, table.createdAt),
    index("audit_outcome_time_idx").on(table.eventType, table.createdAt),
    index("audit_time_idx").on(table.createdAt),
    check(
      "audit_event_type",
      sql`${table.eventType} IN ('requested', 'succeeded', 'failed', 'unknown')`,
    ),
  ],
);
