import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import {
  createControlHandler,
  createMemoryReplayStore,
} from "@yanvah/control/server";

export type TestCredential = { keyId: string; secret: string };
export type TestProduct = {
  endpoint: string;
  credentials: TestCredential;
  requestCount: () => number;
  setCredentials: (credential: TestCredential) => void;
  close: () => Promise<void>;
};

export async function serveTestProduct(
  id: string,
  name: string,
  customAction: boolean,
): Promise<TestProduct> {
  const credentials = {
    keyId: `key-${id}`,
    secret: randomBytes(32).toString("base64url"),
  };
  let count = 0;
  function buildHandler(
    credential: TestCredential,
  ): ReturnType<typeof createControlHandler> {
    return createControlHandler({
      product: { id, name },
      auth: credential,
      replayStore: createMemoryReplayStore(),
      users: { search: () => [], ...(customAction ? { get: () => null } : {}) },
      ...(customAction
        ? {
            actions: {
              "count-seats": {
                label: "Count active seats",
                description: "Count seats assigned by this product.",
                risk: "safe" as const,
                run: () => ({ count: 0 }),
              },
            },
          }
        : {}),
    });
  }
  let handler = buildHandler(credentials);
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      count++;
      const chunks: Uint8Array[] = [];
      for await (const chunk of incoming) {
        const value: unknown = chunk;
        if (!(value instanceof Uint8Array))
          throw new Error("Invalid test HTTP body.");
        chunks.push(value);
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (typeof value === "string") headers.set(key, value);
        else if (value) for (const part of value) headers.append(key, part);
      }
      const response = await handler(
        new Request(`http://127.0.0.1${incoming.url ?? "/"}`, {
          method: incoming.method ?? "POST",
          headers,
          body: Buffer.concat(chunks),
        }),
      );
      outgoing.statusCode = response.status;
      response.headers.forEach((value, key) => outgoing.setHeader(key, value));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    })().catch(() => {
      outgoing.statusCode = 500;
      outgoing.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Test product did not start.");
  return {
    endpoint: `http://127.0.0.1:${address.port}/api/yanvah-control`,
    credentials,
    requestCount: () => count,
    setCredentials: (credential) => {
      handler = buildHandler(credential);
    },
    close: async () => {
      if (!server.listening) return;
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
