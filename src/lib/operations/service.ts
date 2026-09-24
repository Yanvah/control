import "server-only";
import { beginAudit, completeAudit, describeAudit } from "@/lib/audit/context";
import { targetReference } from "@/lib/audit/redaction";
import { startAudit, finishAudit } from "@/lib/audit/store";
import { createHmac, randomUUID } from "node:crypto";
import type { Actor, Capabilities, JsonValue } from "@yanvah/control";
import { and, eq, ne } from "drizzle-orm";
import { getDatabase, getSqlite } from "@/db/client";
import { auditEvents, operationEvents, products } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { decryptProductSecret } from "@/lib/encryption/secrets";
import {
  assertNoCredentials,
  capabilityVersion,
  safeOperationCode,
  withProductConnection,
} from "@/lib/control/product-connection";
import { RequestError } from "@/lib/security/request";
import type { MutationRequest, MutationResult } from "@/lib/users/models";

type Event = typeof operationEvents.$inferSelect;
const state = globalThis as typeof globalThis & {
  controlActiveOperations?: Set<string>;
};
const active = (state.controlActiveOperations ??= new Set<string>());

function fingerprint(
  productId: string,
  actorId: string,
  input: MutationRequest,
): string {
  return createHmac(
    "sha256",
    Buffer.from(getEnv().CONTROL_ENCRYPTION_KEY, "base64"),
  )
    .update("yanvah-control-operation-attempt\0")
    .update(JSON.stringify({ productId, actorId, ...input }))
    .digest("hex");
}

function requestedEvent(attemptId: string, actorId: string): Event | undefined {
  return getDatabase()
    .select()
    .from(operationEvents)
    .where(
      and(
        eq(operationEvents.attemptId, attemptId),
        eq(operationEvents.actorId, actorId),
        eq(operationEvents.eventType, "requested"),
      ),
    )
    .get();
}

function finish(requested: Event, result: MutationResult): void {
  if (result.state === "pending") return;
  const outcome = result.state;
  const completed = getSqlite()
    .transaction(() => {
      getDatabase()
        .insert(operationEvents)
        .values({
          ...requested,
          id: randomUUID(),
          eventType: outcome,
          requestId: result.requestId,
          safeCode: result.code,
          durationMs: Math.max(0, Date.now() - requested.createdAt.getTime()),
          createdAt: new Date(),
        })
        .onConflictDoNothing()
        .run();
      let audit = getDatabase()
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.attemptId, requested.attemptId),
            eq(auditEvents.eventType, "requested"),
          ),
        )
        .get();
      audit ??= startAudit({
        action: requested.operation as MutationRequest["operation"],
        actorId: requested.actorId,
        productId: requested.productId,
        attemptId: requested.attemptId,
        targetType:
          requested.operation === "actions.invoke" ? "action" : "user",
        targetId: requested.targetId,
        metadata: { imported: true },
      });
      return finishAudit(
        audit,
        outcome,
        result.code,
        result.requestId ? { sdkRequestId: result.requestId } : {},
      );
    })
    .immediate();
  completeAudit(completed);
}

export function getOperationOutcome(
  attemptId: string,
  actorId: string,
): MutationResult {
  const requested = requestedEvent(attemptId, actorId);
  if (!requested) throw new RequestError(404, "ATTEMPT_NOT_FOUND");
  const terminal = getDatabase()
    .select()
    .from(operationEvents)
    .where(
      and(
        eq(operationEvents.attemptId, attemptId),
        ne(operationEvents.eventType, "requested"),
      ),
    )
    .get();
  if (terminal && terminal.eventType !== "requested")
    return {
      attemptId,
      state: terminal.eventType,
      code: terminal.safeCode,
      requestId: terminal.requestId,
    };
  if (active.has(attemptId))
    return { attemptId, state: "pending", code: null, requestId: null };
  // An interrupted process may have sent the mutation. Never resume or replay it.
  const result: MutationResult = {
    attemptId,
    state: "unknown",
    code: "PROCESS_INTERRUPTED",
    requestId: null,
  };
  finish(requested, result);
  return result;
}

function checkConfirmation(
  input: MutationRequest,
  capabilities: Capabilities,
  productName: string,
): void {
  if (capabilityVersion(capabilities) !== input.capabilityVersion)
    throw new RequestError(409, "CAPABILITIES_CHANGED");
  if (!capabilities.operations.includes(input.operation))
    throw new RequestError(409, "OPERATION_UNSUPPORTED");
  if (
    input.operation === "users.ban" &&
    input.confirmation !== input.input.userId
  )
    throw new RequestError(400, "CONFIRMATION_REQUIRED");
  if (input.operation === "actions.invoke") {
    const action = capabilities.actions.find(
      (action) => action.id === input.input.actionId,
    );
    if (!action) throw new RequestError(409, "OPERATION_UNSUPPORTED");
    if (action.risk === "dangerous" && input.confirmation !== productName)
      throw new RequestError(400, "CONFIRMATION_REQUIRED");
  }
}

export async function executeOperation(
  productId: string,
  input: MutationRequest,
  actor: Actor,
): Promise<MutationResult> {
  const digest = fingerprint(productId, actor.id, input);
  const existing = requestedEvent(input.attemptId, actor.id);
  if (existing) {
    if (existing.inputFingerprint !== digest)
      throw new RequestError(409, "ATTEMPT_CONFLICT");
    describeAudit({
      action: "operation.receipt",
      actorId: actor.id,
      productId,
      metadata: { duplicate: true },
    });
    return getOperationOutcome(input.attemptId, actor.id);
  }
  const product = getDatabase()
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .get();
  if (!product) throw new RequestError(404, "PRODUCT_NOT_FOUND");
  if (!product.enabled) throw new RequestError(409, "PRODUCT_DISABLED");
  const secret = decryptProductSecret(product, productId, product.keyId);
  assertNoCredentials(input, secret);
  const targetId =
    input.operation === "actions.invoke"
      ? input.input.actionId
      : input.operation === "users.create"
        ? input.input.email
        : input.input.userId;
  const requested: Event = {
    id: randomUUID(),
    attemptId: input.attemptId,
    actorId: actor.id,
    productId,
    operation: input.operation,
    targetId: targetReference(targetId),
    inputFingerprint: digest,
    eventType: "requested",
    requestId: null,
    safeCode: null,
    durationMs: null,
    createdAt: new Date(),
  };
  // Commit intent before opening the connection. The synchronous transaction and
  // unique attempt index ensure a duplicate cannot dispatch a second mutation.
  getSqlite()
    .transaction(() => {
      beginAudit({
        action: input.operation,
        actorId: actor.id,
        productId,
        attemptId: input.attemptId,
        targetType: input.operation === "actions.invoke" ? "action" : "user",
        targetId,
      });
      getDatabase().insert(operationEvents).values(requested).run();
    })
    .immediate();
  active.add(input.attemptId);
  let result: MutationResult = {
    attemptId: input.attemptId,
    state: "failed",
    code: "CONNECTION_FAILED",
    requestId: null,
  };
  try {
    result = await withProductConnection(
      productId,
      actor,
      undefined,
      async (connection) => {
        const capabilities = connection.validate(
          await connection.client.getCapabilities(),
        );
        checkConfirmation(input, capabilities, product.name);
        if (
          input.operation !== "actions.invoke" &&
          input.operation !== "users.create" &&
          capabilities.operations.includes("users.get")
        ) {
          const { user } = connection.validate(
            await connection.client.invoke("users.get", {
              userId: input.input.userId,
            }),
          );
          if (!user) throw new RequestError(404, "USER_NOT_FOUND");
        }
        connection.assertCurrent();
        // Discovery and user lookup are reads; only the following dispatch can
        // leave the mutation's outcome unknown when its response is lost.
        connection.resetAttempt();
        try {
          let output: JsonValue;
          switch (input.operation) {
            case "users.create":
              output = await connection.client.invoke(
                "users.create",
                input.input,
              );
              break;
            case "users.ban":
              output = await connection.client.invoke("users.ban", input.input);
              break;
            case "users.unban":
              output = await connection.client.invoke(
                "users.unban",
                input.input,
              );
              break;
            case "users.revokeSessions":
              output = await connection.client.invoke(
                "users.revokeSessions",
                input.input,
              );
              break;
            case "subscriptions.changePlan":
              output = await connection.client.invoke(
                "subscriptions.changePlan",
                input.input,
              );
              break;
            case "actions.invoke":
              output = await connection.client.invoke(
                "actions.invoke",
                input.input,
              );
              break;
          }
          output = connection.validate(output);
          return {
            attemptId: input.attemptId,
            state: "succeeded",
            code: null,
            requestId: connection.requestId,
            output,
          };
        } catch (error) {
          const code = safeOperationCode(error);
          const rejectedBeforeExecution = [
            "AUTHENTICATION_FAILED",
            "REQUEST_EXPIRED",
            "INVALID_INPUT",
            "OPERATION_UNSUPPORTED",
            "USER_ALREADY_EXISTS",
          ].includes(code);
          return {
            attemptId: input.attemptId,
            state:
              connection.dispatched && !rejectedBeforeExecution
                ? "unknown"
                : "failed",
            code,
            requestId: connection.requestId,
          };
        }
      },
    );
  } catch (error) {
    result = {
      attemptId: input.attemptId,
      state: "failed",
      code: safeOperationCode(error),
      requestId: null,
    };
  } finally {
    active.delete(input.attemptId);
  }
  finish(requested, result);
  return result;
}
