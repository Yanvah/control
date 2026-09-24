import "server-only";
import type { Actor } from "@yanvah/control";
import { listProducts, getProduct } from "@/lib/products/service";
import {
  capabilityVersion,
  readFailure,
  withProductConnection,
} from "@/lib/control/product-connection";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { RequestError } from "@/lib/security/request";
import type { ProductSummary, SearchResult, UserDetail } from "./models";

export async function searchProduct(
  product: ProductSummary,
  query: string,
  actor: Actor,
  signal?: AbortSignal,
): Promise<SearchResult> {
  try {
    return await withProductConnection(
      product.id,
      actor,
      signal,
      async (connection) => {
        const capabilities = connection.validate(
          await connection.client.getCapabilities(),
        );
        if (!capabilities.operations.includes("users.search"))
          return {
            product,
            state: "unsupported",
            code: "OPERATION_UNSUPPORTED",
          };
        connection.validate({ query });
        const result = connection.validate(
          await connection.client.invoke("users.search", { query, limit: 20 }),
        );
        connection.assertCurrent();
        return result.users.length
          ? {
              product,
              state: "found",
              users: result.users,
              operations: capabilities.operations,
              limited: result.users.length === 20,
            }
          : { product, state: "not_found" };
      },
    );
  } catch (error) {
    return { product, ...readFailure(error) };
  }
}

export async function searchUsers(
  query: string,
  actor: Actor,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const selected = listProducts()
    .filter((product) => product.enabled)
    .map(({ id, name }) => ({ id, name }));
  const results: SearchResult[] = new Array<SearchResult>(selected.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, selected.length) }, async () => {
      while (cursor < selected.length) {
        const index = cursor++;
        results[index] = signal?.aborted
          ? {
              product: selected[index],
              state: "canceled",
              code: "REQUEST_ABORTED",
            }
          : await searchProduct(selected[index], query, actor, signal);
      }
    }),
  );
  return results;
}

export async function getUserDetail(
  productId: string,
  userId: string | undefined,
  actor: Actor,
  signal?: AbortSignal,
): Promise<UserDetail> {
  const product = getProduct(productId);
  if (!product) throw new RequestError(404, "PRODUCT_NOT_FOUND");
  const summary = { id: product.id, name: product.name };
  try {
    enforceRateLimit("user-read", 60);
    return await withProductConnection(
      productId,
      actor,
      signal,
      async (connection) => {
        const capabilities = connection.validate(
          await connection.client.getCapabilities(),
        );
        connection.validate({ userId });
        const detail: UserDetail = {
          product: summary,
          capabilities,
          capabilityVersion: capabilityVersion(capabilities),
          user: { state: "unsupported", code: "OPERATION_UNSUPPORTED" },
          subscription: { state: "unsupported", code: "OPERATION_UNSUPPORTED" },
        };
        if (
          userId !== undefined &&
          capabilities.operations.includes("users.get")
        ) {
          try {
            detail.user = {
              state: "ready",
              data: connection.validate(
                await connection.client.invoke("users.get", { userId }),
              ).user,
            };
          } catch (error) {
            detail.user = readFailure(error);
          }
        }
        if (
          userId !== undefined &&
          capabilities.operations.includes("subscriptions.get")
        ) {
          try {
            detail.subscription = {
              state: "ready",
              data: connection.validate(
                await connection.client.invoke("subscriptions.get", { userId }),
              ).subscription,
            };
          } catch (error) {
            detail.subscription = readFailure(error);
          }
        }
        connection.assertCurrent();
        return detail;
      },
    );
  } catch (error) {
    return {
      product: summary,
      capabilities: null,
      capabilityVersion: null,
      user: readFailure(error),
      subscription: readFailure(error),
    };
  }
}
