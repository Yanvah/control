import { z } from "zod";
import {
  capabilitiesSchema,
  jsonValueSchema,
  operationInputSchemas,
  operationNameSchema,
  subscriptionSchema,
  userSchema,
} from "@yanvah/control";

export const productSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().max(200),
});
export const failureStateSchema = z.enum([
  "offline",
  "unauthorized",
  "failed",
  "canceled",
  "unsupported",
]);
const readFailureSchema = z.object({
  state: failureStateSchema,
  code: z.string(),
});
export const userReadSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ready"), data: userSchema.nullable() }),
  readFailureSchema,
]);
export const subscriptionReadSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ready"), data: subscriptionSchema.nullable() }),
  readFailureSchema,
]);
export const searchInputSchema = operationInputSchemas["users.search"]
  .pick({ query: true })
  .extend({
    channelId: z.uuid(),
    sequence: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
  });
export const searchResultSchema = z.discriminatedUnion("state", [
  z.object({
    product: productSummarySchema,
    state: z.literal("found"),
    users: z.array(userSchema).max(20),
    operations: z.array(operationNameSchema),
    limited: z.boolean(),
  }),
  z.object({ product: productSummarySchema, state: z.literal("not_found") }),
  z.object({
    product: productSummarySchema,
    state: failureStateSchema,
    code: z.string(),
  }),
]);
export const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
});
export const detailResponseSchema = z.object({
  product: productSummarySchema,
  capabilities: capabilitiesSchema.nullable(),
  capabilityVersion: z.string().nullable(),
  user: userReadSchema,
  subscription: subscriptionReadSchema,
});
const attemptFields = {
  attemptId: z.uuid(),
  capabilityVersion: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.literal(true),
  confirmation: z.string().max(400),
};
export const mutationRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    ...attemptFields,
    operation: z.literal("users.create"),
    input: operationInputSchemas["users.create"],
  }),
  z.strictObject({
    ...attemptFields,
    operation: z.literal("users.ban"),
    input: operationInputSchemas["users.ban"],
  }),
  z.strictObject({
    ...attemptFields,
    operation: z.literal("users.unban"),
    input: operationInputSchemas["users.unban"],
  }),
  z.strictObject({
    ...attemptFields,
    operation: z.literal("users.revokeSessions"),
    input: operationInputSchemas["users.revokeSessions"],
  }),
  z.strictObject({
    ...attemptFields,
    operation: z.literal("subscriptions.changePlan"),
    input: operationInputSchemas["subscriptions.changePlan"],
  }),
  z.strictObject({
    ...attemptFields,
    operation: z.literal("actions.invoke"),
    input: operationInputSchemas["actions.invoke"],
  }),
]);
export const mutationResultSchema = z.object({
  attemptId: z.uuid(),
  state: z.enum(["pending", "succeeded", "failed", "unknown"]),
  code: z.string().nullable(),
  requestId: z.string().nullable(),
  output: jsonValueSchema.optional(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
export type UserDetail = z.infer<typeof detailResponseSchema>;
export type MutationRequest = z.infer<typeof mutationRequestSchema>;
export type MutationResult = z.infer<typeof mutationResultSchema>;
export type ReadFailure = z.infer<typeof readFailureSchema>;
export type ProductSummary = z.infer<typeof productSummarySchema>;

export function userDetailPath(productId: string, userId: string): string {
  return `/users/${encodeURIComponent(productId)}?userId=${encodeURIComponent(userId)}`;
}
