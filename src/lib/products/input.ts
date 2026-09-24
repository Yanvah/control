import "server-only";
import { requestHeadersSchema } from "@yanvah/control";
import { z } from "zod";

// This is application credential input validation. The SDK owns wire validation
// and signing; its documented secret is literal UTF-8, not base64-decoded bytes.
const secretInput = z
  .string()
  .regex(/\S/)
  .refine((value) => {
    const length = Buffer.byteLength(value, "utf8");
    return length >= 32 && length <= 1024;
  });

export const credentialInputSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("generate") }),
  z.strictObject({
    mode: z.literal("existing"),
    keyId: requestHeadersSchema.shape.keyId,
    secret: secretInput,
  }),
]);
export const registerProductSchema = z.strictObject({
  name: z.string().trim().min(1).max(200).regex(/\S/),
  endpoint: z.string().min(1).max(2048),
  credentials: credentialInputSchema,
});
export const productIdSchema = z.uuid();
export const setProductEnabledSchema = z.strictObject({ enabled: z.boolean() });
export const removeProductSchema = z.strictObject({
  confirmation: z.string().min(1).max(200),
});
export const replaceProductCredentialsSchema = z.strictObject({
  credentials: credentialInputSchema,
  confirmation: z.string().min(1).max(200),
});
export const testProductSchema = z.strictObject({});
