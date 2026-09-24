import path from "node:path";
import { z } from "zod";

const secret = z.string().min(32).max(512).regex(/^\S+$/);
const booleanFlag = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    CONTROL_URL: z.string().url(),
    CONTROL_AUTH_SECRET: secret,
    CONTROL_ENCRYPTION_KEY: z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/)
      .refine((value) => {
        const bytes = Buffer.from(value, "base64");
        return bytes.length === 32 && bytes.toString("base64") === value;
      }),
    CONTROL_SETUP_TOKEN: secret.optional(),
    DATABASE_PATH: z.string().min(1).default("/data/control.db"),
    CONTROL_ALLOW_HTTP_ENDPOINTS: booleanFlag,
    CONTROL_ALLOW_PRIVATE_ENDPOINTS: booleanFlag,
  })
  .superRefine((env, context) => {
    const url = new URL(env.CONTROL_URL);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      context.addIssue({
        code: "custom",
        path: ["CONTROL_URL"],
        message: "Must be a bare origin",
      });
    }
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && local && env.NODE_ENV !== "production")
    ) {
      context.addIssue({
        code: "custom",
        path: ["CONTROL_URL"],
        message: "HTTPS required except on local development loopback",
      });
    }
    const normalized = path.resolve(env.DATABASE_PATH);
    if (
      env.NODE_ENV === "production" &&
      (!path.isAbsolute(env.DATABASE_PATH) || !normalized.startsWith("/data/"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_PATH"],
        message: "Production database must be under /data",
      });
    }
    if (env.NODE_ENV === "production" && env.CONTROL_ALLOW_HTTP_ENDPOINTS) {
      context.addIssue({
        code: "custom",
        path: ["CONTROL_ALLOW_HTTP_ENDPOINTS"],
        message: "Not allowed in production",
      });
    }
    const secrets = [
      env.CONTROL_AUTH_SECRET,
      env.CONTROL_ENCRYPTION_KEY,
      env.CONTROL_SETUP_TOKEN,
    ].filter((value) => value !== undefined);
    if (new Set(secrets).size !== secrets.length) {
      context.addIssue({
        code: "custom",
        path: ["CONTROL_AUTH_SECRET"],
        message: "Secrets must be independent",
      });
    }
  })
  .transform((env) => ({
    ...env,
    CONTROL_URL: new URL(env.CONTROL_URL).origin,
    DATABASE_PATH: path.resolve(env.DATABASE_PATH),
  }));

export type ControlEnv = z.infer<typeof environmentSchema>;

export function parseEnv(
  input: Record<string, string | undefined>,
): ControlEnv {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
    ].join(", ");
    // Deliberately omit input values and Zod's detailed errors from startup output.
    throw new Error(
      `Invalid Control configuration: ${fields}. See .env.example and README.md.`,
    );
  }
  return result.data;
}
