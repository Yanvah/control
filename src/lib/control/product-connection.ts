import "server-only";
import { acquireOperationSlot } from "./slots";
import { createHash } from "node:crypto";
import { discoverCapabilities } from "./discovery";
import {
  CONTROL_HEADERS,
  type Actor,
  type Capabilities,
  type ProtocolVersion,
} from "@yanvah/control";
import {
  ControlClientError,
  createControlClient,
  type ControlClient,
} from "@yanvah/control/client";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { products } from "@/db/schema";
import { decryptProductSecret } from "@/lib/encryption/secrets";
import { getEnv } from "@/lib/env";
import { EndpointError } from "@/lib/security/endpoint";
import { RequestError } from "@/lib/security/request";
import type { ReadFailure } from "@/lib/users/models";
import {
  CONTROL_MAX_RESPONSE_BYTES,
  CONTROL_REQUEST_TIMEOUT_MS,
  createSafeTransport,
} from "./transport";

const state = globalThis as typeof globalThis & {
  controlOperationConnections?: Map<string, Set<AbortController>>;
};
const active = (state.controlOperationConnections ??= new Map<
  string,
  Set<AbortController>
>());

export function cancelProductOperations(productId: string): void {
  for (const controller of active.get(productId) ?? []) controller.abort();
}

/** Check SDK-validated JSON before storing it or returning it to the browser. */
export function assertNoCredentials(value: unknown, secret: string): void {
  const env = getEnv();
  const secrets = [
    secret,
    env.CONTROL_AUTH_SECRET,
    env.CONTROL_ENCRYPTION_KEY,
    env.CONTROL_SETUP_TOKEN,
  ].filter((item): item is string => Boolean(item));
  const contains = (entry: unknown): boolean => {
    if (typeof entry === "string")
      return secrets.some((item) => entry.includes(item));
    if (Array.isArray(entry)) return entry.some(contains);
    if (entry !== null && typeof entry === "object")
      return Object.entries(entry).some(
        ([key, item]) => contains(key) || contains(item),
      );
    return false;
  };
  if (contains(value)) throw new RequestError(502, "INVALID_RESPONSE");
}

/** Bind a confirmation to the exact capabilities the owner reviewed. */
export function capabilityVersion(capabilities: Capabilities): string {
  return createHash("sha256")
    .update(JSON.stringify(capabilities))
    .digest("hex");
}

export function safeOperationCode(error: unknown): string {
  if (
    error instanceof ControlClientError ||
    error instanceof EndpointError ||
    error instanceof RequestError
  )
    return error.code;
  return "CONNECTION_FAILED";
}

export function readFailure(error: unknown): ReadFailure {
  const code = safeOperationCode(error);
  const state =
    code === "AUTHENTICATION_FAILED"
      ? "unauthorized"
      : code === "REQUEST_ABORTED"
        ? "canceled"
        : code === "OPERATION_UNSUPPORTED"
          ? "unsupported"
          : [
                "PRODUCT_UNAVAILABLE",
                "ENDPOINT_UNAVAILABLE",
                "REQUEST_TIMEOUT",
              ].includes(code)
            ? "offline"
            : "failed";
  return { state, code };
}

export interface ProductConnection {
  client: ControlClient;
  readonly requestId: string | null;
  readonly dispatched: boolean;
  resetAttempt(): void;
  assertCurrent(): void;
  validate<T>(value: T): T;
}

export async function withProductConnection<T>(
  productId: string,
  actor: Actor,
  signal: AbortSignal | undefined,
  work: (connection: ProductConnection) => Promise<T>,
): Promise<T> {
  const record = getDatabase()
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .get();
  if (!record) throw new RequestError(404, "PRODUCT_NOT_FOUND");
  if (!record.enabled) throw new RequestError(409, "PRODUCT_DISABLED");
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const group = active.get(productId) ?? new Set<AbortController>();
  group.add(controller);
  active.set(productId, group);
  let transport: ReturnType<typeof createSafeTransport> | undefined;
  let release: (() => void) | undefined;
  try {
    release = await acquireOperationSlot(controller.signal);
    let secret: string;
    try {
      secret = decryptProductSecret(record, productId, record.keyId);
    } catch {
      throw new RequestError(409, "CREDENTIAL_UNAVAILABLE");
    }
    const assertCurrent = (): void => {
      if (controller.signal.aborted)
        throw new RequestError(409, "REQUEST_ABORTED");
      const current = getDatabase()
        .select({ revision: products.revision, enabled: products.enabled })
        .from(products)
        .where(eq(products.id, productId))
        .get();
      if (!current?.enabled || current.revision !== record.revision)
        throw new RequestError(409, "PRODUCT_CHANGED");
    };
    assertCurrent();
    let requestId: string | null = null;
    let dispatched = false;
    transport = createSafeTransport(record.endpoint, {
      onDispatch: () => {
        dispatched = true;
      },
    });
    const safeTransport = transport;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      assertCurrent();
      const request =
        input instanceof Request && !init ? input : new Request(input, init);
      requestId = request.headers.get(CONTROL_HEADERS.requestId);
      return safeTransport.fetch(request);
    };
    const clientFor = (protocolVersion: ProtocolVersion): ControlClient =>
      createControlClient({
        endpoint: record.endpoint,
        keyId: record.keyId,
        secret,
        protocolVersion,
        fetch,
        timeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
        maxResponseBytes: CONTROL_MAX_RESPONSE_BYTES,
      });
    let selected: ControlClient | null = null;
    const client: ControlClient = {
      getCapabilities: async () => {
        const discovered = await discoverCapabilities(clientFor, {
          actor,
          signal: controller.signal,
        });
        selected = discovered.client;
        return discovered.capabilities;
      },
      invoke: (operation, input) => {
        if (!selected) throw new RequestError(409, "CAPABILITIES_CHANGED");
        return selected.invoke(operation, input, {
          actor,
          signal: controller.signal,
        });
      },
    };
    return await work({
      client,
      get requestId() {
        return requestId;
      },
      get dispatched() {
        return dispatched;
      },
      resetAttempt: () => {
        requestId = null;
        dispatched = false;
      },
      assertCurrent,
      validate: <V>(value: V): V => {
        assertNoCredentials(value, secret);
        return value;
      },
    });
  } finally {
    transport?.close();
    release?.();
    signal?.removeEventListener("abort", abort);
    group.delete(controller);
    if (!group.size) active.delete(productId);
  }
}
