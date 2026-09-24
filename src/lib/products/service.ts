import "server-only";
import {
  assertNoCredentials,
  cancelProductOperations,
} from "@/lib/control/product-connection";
import { randomBytes, randomUUID } from "node:crypto";
import { capabilitiesSchema, type Capabilities } from "@yanvah/control";
import {
  ControlClientError,
  createControlClient,
} from "@yanvah/control/client";
import { discoverCapabilities } from "@/lib/control/discovery";
import { and, asc, eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { products } from "@/db/schema";
import {
  CONTROL_MAX_CONCURRENT_REQUESTS,
  CONTROL_MAX_RESPONSE_BYTES,
  CONTROL_REQUEST_TIMEOUT_MS,
  createSafeTransport,
} from "@/lib/control/transport";
import {
  decryptProductSecret,
  encryptProductSecret,
  productSecretFingerprint,
} from "@/lib/encryption/secrets";
import { getEnv } from "@/lib/env";
import {
  EndpointError,
  validateProductEndpoint,
} from "@/lib/security/endpoint";
import { RequestError } from "@/lib/security/request";
import type {
  CredentialInput,
  ProductStatus,
  ProductView,
  ProductWriteResult,
} from "./types";

type ProductRecord = typeof products.$inferSelect;
const processState = globalThis as typeof globalThis & {
  controlProductConnections?: Map<string, AbortController>;
};
const connections = (processState.controlProductConnections ??= new Map<
  string,
  AbortController
>());

function storedCapabilities(value: string | null): Capabilities | null {
  if (value === null) return null;
  try {
    return capabilitiesSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

function productView(record: ProductRecord): ProductView {
  const capabilities = storedCapabilities(record.capabilitiesJson);
  const invalidMetadata =
    record.capabilitiesJson !== null && capabilities === null;
  return {
    id: record.id,
    name: record.name,
    endpoint: record.endpoint,
    enabled: record.enabled,
    keyId: record.keyId,
    status: invalidMetadata ? "degraded" : record.lastConnectionStatus,
    capabilities,
    lastConnectedAt: record.lastConnectedAt?.toISOString() ?? null,
    lastTestedAt: record.lastTestedAt?.toISOString() ?? null,
    lastErrorCode: invalidMetadata
      ? "INVALID_RESPONSE"
      : record.lastSafeErrorCode,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function requireProduct(id: string): ProductRecord {
  const record = getDatabase()
    .select()
    .from(products)
    .where(eq(products.id, id))
    .get();
  if (!record) throw new RequestError(404, "PRODUCT_NOT_FOUND");
  return record;
}

function credentialsFor(input: CredentialInput): {
  keyId: string;
  secret: string;
} {
  if (input.mode === "generate")
    return {
      keyId: `control_${randomBytes(16).toString("hex")}`,
      secret: randomBytes(32).toString("base64url"),
    };
  return { keyId: input.keyId, secret: input.secret };
}

function assertIndependentCredential(secret: string): string {
  const env = getEnv();
  const fingerprint = productSecretFingerprint(secret);
  if (
    [
      env.CONTROL_AUTH_SECRET,
      env.CONTROL_ENCRYPTION_KEY,
      env.CONTROL_SETUP_TOKEN,
    ].includes(secret) ||
    getDatabase()
      .select({ id: products.id })
      .from(products)
      .where(eq(products.secretFingerprint, fingerprint))
      .get()
  ) {
    throw new RequestError(409, "CREDENTIAL_REUSED");
  }
  return fingerprint;
}

function assertSafePublicFields(secret: string, ...values: string[]): void {
  if (values.some((value) => value.includes(secret)))
    throw new RequestError(400, "INVALID_REQUEST");
}

function confirmProduct(record: ProductRecord, confirmation: string): void {
  if (confirmation !== record.name)
    throw new RequestError(400, "CONFIRMATION_REQUIRED");
}

export function listProducts(): ProductView[] {
  return getDatabase()
    .select()
    .from(products)
    .orderBy(asc(products.name), asc(products.id))
    .all()
    .map(productView);
}

export function getProduct(id: string): ProductView | null {
  const record = getDatabase()
    .select()
    .from(products)
    .where(eq(products.id, id))
    .get();
  return record ? productView(record) : null;
}

export async function registerProduct(input: {
  name: string;
  endpoint: string;
  credentials: CredentialInput;
}): Promise<ProductWriteResult> {
  let endpoint: string;
  try {
    endpoint = await validateProductEndpoint(input.endpoint);
  } catch (error) {
    if (error instanceof EndpointError) throw new RequestError(400, error.code);
    throw error;
  }
  const id = randomUUID();
  const credential = credentialsFor(input.credentials);
  assertSafePublicFields(
    credential.secret,
    input.name,
    endpoint,
    credential.keyId,
  );
  const secretFingerprint = assertIndependentCredential(credential.secret);
  const now = new Date();
  getDatabase()
    .insert(products)
    .values({
      id,
      name: input.name,
      endpoint,
      keyId: credential.keyId,
      ...encryptProductSecret(credential.secret, id, credential.keyId),
      secretFingerprint,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return {
    product: productView(requireProduct(id)),
    ...(input.credentials.mode === "generate"
      ? { credentials: credential }
      : {}),
  };
}

export function setProductEnabled(id: string, enabled: boolean): ProductView {
  const record = requireProduct(id);
  if (record.enabled !== enabled) {
    getDatabase()
      .update(products)
      .set({
        enabled,
        revision: record.revision + 1,
        lastConnectionStatus: "unknown",
        lastSafeErrorCode: null,
        updatedAt: new Date(),
      })
      .where(eq(products.id, id))
      .run();
    connections.get(id)?.abort();
    cancelProductOperations(id);
  }
  return productView(requireProduct(id));
}

export function replaceProductCredentials(
  id: string,
  input: CredentialInput,
  confirmation: string,
): ProductWriteResult {
  const record = requireProduct(id);
  confirmProduct(record, confirmation);
  const credential = credentialsFor(input);
  assertSafePublicFields(
    credential.secret,
    record.name,
    record.endpoint,
    credential.keyId,
  );
  const secretFingerprint = assertIndependentCredential(credential.secret);
  getDatabase()
    .update(products)
    .set({
      keyId: credential.keyId,
      ...encryptProductSecret(credential.secret, id, credential.keyId),
      secretFingerprint,
      revision: record.revision + 1,
      capabilitiesJson: null,
      lastConnectedAt: null,
      lastTestedAt: null,
      lastConnectionStatus: "unknown",
      lastSafeErrorCode: null,
      updatedAt: new Date(),
    })
    .where(eq(products.id, id))
    .run();
  connections.get(id)?.abort();
  cancelProductOperations(id);
  return {
    product: productView(requireProduct(id)),
    ...(input.mode === "generate" ? { credentials: credential } : {}),
  };
}

export function removeProduct(id: string, confirmation: string): void {
  confirmProduct(requireProduct(id), confirmation);
  getDatabase().delete(products).where(eq(products.id, id)).run();
  connections.get(id)?.abort();
  cancelProductOperations(id);
}

function failureStatus(code: string): ProductStatus {
  return [
    "PRODUCT_UNAVAILABLE",
    "REQUEST_TIMEOUT",
    "ENDPOINT_UNAVAILABLE",
    "REQUEST_ABORTED",
  ].includes(code)
    ? "offline"
    : "degraded";
}

export async function testProductConnection(id: string): Promise<ProductView> {
  const record = requireProduct(id);
  if (!record.enabled) throw new RequestError(409, "PRODUCT_DISABLED");
  if (connections.has(id)) throw new RequestError(409, "PRODUCT_BUSY");
  if (connections.size >= CONTROL_MAX_CONCURRENT_REQUESTS)
    throw new RequestError(429, "CONNECTION_LIMIT");
  const controller = new AbortController();
  connections.set(id, controller);
  let transport: ReturnType<typeof createSafeTransport> | undefined;
  let capabilities: Capabilities | undefined;
  let errorCode: string | null = null;
  try {
    let secret: string;
    try {
      secret = decryptProductSecret(record, record.id, record.keyId);
    } catch {
      throw new RequestError(409, "CREDENTIAL_UNAVAILABLE");
    }
    transport = createSafeTransport(record.endpoint, {
      timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
    });
    const discovered = await discoverCapabilities(
      (protocolVersion) =>
        createControlClient({
          endpoint: record.endpoint,
          keyId: record.keyId,
          secret,
          protocolVersion,
          timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
          maxResponseBytes: CONTROL_MAX_RESPONSE_BYTES,
          fetch: transport!.fetch,
        }),
      { signal: controller.signal },
    );
    // Schema-valid metadata is still untrusted. A product must not echo its
    // credential through a field that would later reach the dashboard.
    assertNoCredentials(discovered.capabilities, secret);
    capabilities = discovered.capabilities;
  } catch (error) {
    if (error instanceof ControlClientError) {
      errorCode = error.code;
      const transportCode = transport?.lastError?.code;
      if (
        error.code === "PRODUCT_UNAVAILABLE" &&
        transportCode &&
        transportCode !== "ENDPOINT_UNAVAILABLE"
      )
        errorCode = transportCode;
    } else if (
      error instanceof EndpointError ||
      error instanceof RequestError
    ) {
      errorCode = error.code;
    } else {
      errorCode = "CONNECTION_FAILED";
    }
  } finally {
    transport?.close();
    connections.delete(id);
  }
  const now = new Date();
  const result = getDatabase()
    .update(products)
    .set({
      ...(capabilities
        ? {
            capabilitiesJson: JSON.stringify(capabilities),
            lastConnectedAt: now,
          }
        : {}),
      lastTestedAt: now,
      lastConnectionStatus: capabilities
        ? "online"
        : failureStatus(errorCode ?? "CONNECTION_FAILED"),
      lastSafeErrorCode: errorCode,
      updatedAt: now,
    })
    .where(
      and(
        eq(products.id, id),
        eq(products.revision, record.revision),
        eq(products.enabled, true),
      ),
    )
    .run();
  if (result.changes === 0) throw new RequestError(409, "PRODUCT_CHANGED");
  return productView(requireProduct(id));
}
