import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { z } from "zod";
import {
  CONTROL_HEADERS,
  type Actor,
  type JsonValue,
  type Subscription,
  type User,
} from "@yanvah/control";
import {
  createControlHandler,
  createMemoryReplayStore,
  ControlHandlerError,
  type ControlHandlerContext,
} from "@yanvah/control/server";

export type FixtureMode =
  | "online"
  | "offline"
  | "lost-mutation"
  | "malformed"
  | "secret-output"
  | "timeout-mutation"
  | "throw-mutation"
  | "v1-only";
export interface OperationalProduct {
  endpoint: string;
  credentials: { keyId: string; secret: string };
  user(): User;
  created(email: string): User | undefined;
  subscription(): Subscription;
  requests: { operation: string; requestId: string; actor?: Actor }[];
  mutationCount(): number;
  canceledSearches(): number;
  setMode(mode: FixtureMode): void;
  addAction(): void;
  removeAction(): void;
  close(): Promise<void>;
}

export async function serveOperationalProduct(
  id: string,
  name: string,
  mutable: boolean,
): Promise<OperationalProduct> {
  const credentials = {
    keyId: `fixture_${randomBytes(8).toString("hex")}`,
    secret: randomBytes(32).toString("base64url"),
  };
  const record: User = {
    id: "user_123",
    email: "john@example.com",
    ...(mutable
      ? {
          name: "John Atlas",
          banned: false,
          createdAt: "2026-01-01T00:00:00.000Z",
        }
      : {}),
  };
  const created = new Map<string, User>();
  const subscription: Subscription = {
    id: `sub_${id}`,
    userId: record.id,
    planId: mutable ? "basic" : "team",
    status: "active",
    ...(mutable ? { currentPeriodEnd: "2026-10-01T00:00:00.000Z" } : {}),
  };
  let mode: FixtureMode = "online";
  let mutationCount = 0;
  let canceledSearches = 0;
  let extraAction = false;
  const requests: OperationalProduct["requests"] = [];
  const replayStore = createMemoryReplayStore();
  function createHandler(): ReturnType<typeof createControlHandler> {
    return createControlHandler({
      product: { id, name },
      auth: credentials,
      replayStore,
      users: {
        ...(mutable
          ? {
              create: ({
                email,
                name,
              }: {
                email: string;
                name?: string | undefined;
              }): User => {
                const key = email.toLowerCase();
                if (key === record.email?.toLowerCase() || created.has(key))
                  throw new ControlHandlerError("USER_ALREADY_EXISTS");
                const user: User = {
                  id: `created_${created.size + 1}`,
                  email,
                  ...(name ? { name } : {}),
                };
                created.set(key, user);
                mutationCount++;
                return user;
              },
            }
          : {}),
        search: async ({ query, limit }, context) => {
          if (query === "slow")
            await new Promise<void>((resolve) => {
              const abort = (): void => {
                clearTimeout(timer);
                canceledSearches++;
                resolve();
              };
              const timer = setTimeout(() => {
                context.signal.removeEventListener("abort", abort);
                resolve();
              }, 1500);
              context.signal.addEventListener("abort", abort, { once: true });
            });
          return [record, ...created.values()]
            .filter((user) => user.email?.includes(query) || query === "slow")
            .map((user) => ({ ...user }))
            .slice(0, limit);
        },
        get: ({ userId }) =>
          [record, ...created.values()].find((user) => user.id === userId) ??
          null,
        ...(mutable
          ? {
              ban: async (
                _input: { userId: string; reason?: string },
                context: ControlHandlerContext,
              ) => {
                record.banned = true;
                mutationCount++;
                if (mode === "throw-mutation")
                  throw new Error("fixture private exception");
                if (mode === "timeout-mutation")
                  await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, 6000);
                    context.signal.addEventListener(
                      "abort",
                      () => {
                        clearTimeout(timer);
                        resolve();
                      },
                      { once: true },
                    );
                  });
              },
              unban: () => {
                record.banned = false;
                mutationCount++;
              },
              revokeSessions: () => {
                mutationCount++;
              },
            }
          : {}),
      },
      subscriptions: {
        get: ({ userId }) =>
          userId === record.id ? { ...subscription } : null,
        ...(mutable
          ? {
              changePlan: ({ planId }: { userId: string; planId: string }) => {
                subscription.planId = planId;
                mutationCount++;
              },
            }
          : {}),
      },
      ...(mutable
        ? {
            actions: {
              "grant-credit": {
                label: "Grant credit",
                description:
                  "Grant credits to the userId supplied in the parameters.",
                risk: "dangerous" as const,
                input: z.strictObject({
                  userId: z.literal("user_123"),
                  credits: z.int().min(1).max(10),
                }),
                run: ({
                  credits,
                }: {
                  userId: "user_123";
                  credits: number;
                }): JsonValue => {
                  mutationCount++;
                  return mode === "secret-output"
                    ? { secret: credentials.secret }
                    : { granted: credits };
                },
              },
              ...(extraAction
                ? {
                    "new-action": {
                      label: "New action",
                      description: "A newly advertised action.",
                      risk: "safe" as const,
                      run: () => ({ added: true }),
                    },
                  }
                : {}),
            },
          }
        : {}),
    });
  }
  let handler = createHandler();
  const server = createServer((incoming, outgoing) => {
    if (mode === "offline") {
      incoming.socket.destroy();
      return;
    }
    const controller = new AbortController();
    outgoing.on("close", () => controller.abort());
    void (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of incoming) {
        const value: unknown = chunk;
        if (!(value instanceof Uint8Array))
          throw new Error("Invalid fixture body");
        chunks.push(value);
      }
      const body = Buffer.concat(chunks);
      const data = z
        .object({
          operation: z.string(),
          actor: z
            .object({ id: z.string(), email: z.string().optional() })
            .optional(),
        })
        .parse(JSON.parse(body.toString()));
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value))
          value.forEach((entry) => headers.append(key, entry));
        else if (value !== undefined) headers.set(key, value);
      }
      requests.push({
        operation: data.operation,
        requestId: headers.get(CONTROL_HEADERS.requestId) ?? "",
        actor: data.actor,
      });
      const response =
        mode === "v1-only" && headers.get(CONTROL_HEADERS.version) === "2"
          ? Response.json(
              {
                ok: false,
                requestId: headers.get(CONTROL_HEADERS.requestId),
                error: {
                  code: "AUTHENTICATION_FAILED",
                  message: "Request authentication failed.",
                },
              },
              { status: 401 },
            )
          : await handler(
              new Request(`http://127.0.0.1${incoming.url}`, {
                method: "POST",
                headers,
                body,
                signal: controller.signal,
              }),
            );
      const mutation = [
        "users.create",
        "users.ban",
        "users.unban",
        "users.revokeSessions",
        "subscriptions.changePlan",
        "actions.invoke",
      ].includes(data.operation);
      if (mode === "lost-mutation" && mutation) {
        outgoing.destroy();
        return;
      }
      outgoing.statusCode = response.status;
      response.headers.forEach((value, key) => outgoing.setHeader(key, value));
      outgoing.end(
        mode === "malformed"
          ? "not json"
          : new Uint8Array(await response.arrayBuffer()),
      );
    })().catch(() => {
      if (!outgoing.destroyed) {
        outgoing.statusCode = 500;
        outgoing.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture port unavailable");
  return {
    endpoint: `http://127.0.0.1:${address.port}/api/control`,
    credentials,
    user: () => ({ ...record }),
    created: (email) => created.get(email.toLowerCase()),
    subscription: () => ({ ...subscription }),
    requests,
    mutationCount: () => mutationCount,
    canceledSearches: () => canceledSearches,
    setMode: (next) => {
      mode = next;
    },
    addAction: () => {
      extraAction = true;
      handler = createHandler();
    },
    removeAction: () => {
      extraAction = false;
      handler = createHandler();
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
