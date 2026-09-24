import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupAllOptions } from "node:dns";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { afterEach, expect, test, vi, type TestContext } from "vitest";
import { createControlClient } from "@yanvah/control/client";
import {
  createControlHandler,
  createMemoryReplayStore,
  type ControlHandler,
} from "@yanvah/control/server";
import {
  createSafeTransport,
  CONTROL_MAX_CONCURRENT_REQUESTS,
  CONTROL_MAX_RESPONSE_BYTES,
} from "./transport";
import type { EndpointPolicy } from "@/lib/security/endpoint";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
const lookupAll: (
  hostname: string,
  options: LookupAllOptions,
) => Promise<LookupAddress[]> = lookup;
const policy: EndpointPolicy = {
  NODE_ENV: "test",
  CONTROL_ALLOW_HTTP_ENDPOINTS: true,
  CONTROL_ALLOW_PRIVATE_ENDPOINTS: true,
};
const auth = {
  keyId: "transport-test",
  secret: "transport-fixture-independent-secret-32-bytes",
};

afterEach(() => {
  vi.clearAllMocks();
});

async function serve(
  context: TestContext,
  respond: (incoming: IncomingMessage, outgoing: ServerResponse) => void,
): Promise<string> {
  const server = createServer(respond);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing local server address.");
  return `http://localhost:${address.port}/api/control%2Fsigned`;
}

function realHandler(): ControlHandler {
  return createControlHandler({
    product: { id: "transport-product", name: "Transport Product" },
    auth,
    replayStore: createMemoryReplayStore(),
    users: { search: () => [] },
  });
}

function sdkResponder(
  handler: ControlHandler,
): (incoming: IncomingMessage, outgoing: ServerResponse) => void {
  return (incoming, outgoing): void => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value))
          value.forEach((entry) => headers.append(name, entry));
        else if (value !== undefined) headers.set(name, value);
      }
      const request = new Request(
        `http://${incoming.headers.host}${incoming.url}`,
        { method: incoming.method, headers, body: Buffer.concat(chunks) },
      );
      const response = await handler(request);
      outgoing.writeHead(
        response.status,
        Object.fromEntries(response.headers.entries()),
      );
      const body = Buffer.from(await response.arrayBuffer());
      outgoing.end(body);
    })().catch(() => {
      outgoing.destroy();
    });
  };
}

test("uses real SDK authentication and exact signed encoded paths while pinning DNS to one lookup", async (context) => {
  vi.mocked(lookupAll)
    .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }])
    .mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
  let requests = 0;
  let host = "";
  const respond = sdkResponder(realHandler());
  const endpoint = await serve(context, (incoming, outgoing) => {
    requests++;
    host = incoming.headers.host ?? "";
    respond(incoming, outgoing);
  });
  const transport = createSafeTransport(endpoint, { policy });
  context.onTestFinished(() => transport.close());
  const client = createControlClient({
    endpoint,
    ...auth,
    fetch: transport.fetch,
    maxResponseBytes: CONTROL_MAX_RESPONSE_BYTES,
  });
  const capabilities = await client.getCapabilities();
  expect(capabilities.product.name).toBe("Transport Product");
  expect(host).toBe(new URL(endpoint).host);
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(requests).toBe(1);
  // A fresh attempt must resolve again and must reject a rebinding response.
  await expect(client.getCapabilities()).rejects.toMatchObject({
    code: "PRODUCT_UNAVAILABLE",
  });
  expect(transport.lastError?.code).toBe("UNSAFE_ENDPOINT");
  expect(requests).toBe(1);
  expect(lookup).toHaveBeenCalledTimes(2);
});

for (const encoding of ["gzip", "deflate", "br"] as const)
  test(`decompresses ${encoding} before real SDK parsing and byte limits`, async (context) => {
    vi.mocked(lookupAll).mockResolvedValue([
      { address: "127.0.0.1", family: 4 },
    ]);
    const handler = realHandler();
    const compress =
      encoding === "gzip"
        ? gzipSync
        : encoding === "deflate"
          ? deflateSync
          : brotliCompressSync;
    const endpoint = await serve(context, (incoming, outgoing) => {
      void (async () => {
        const body: Buffer[] = [];
        for await (const chunk of incoming) body.push(Buffer.from(chunk));
        const response = await handler(
          new Request(`http://${incoming.headers.host}${incoming.url}`, {
            method: "POST",
            headers: incoming.headers as Record<string, string>,
            body: Buffer.concat(body),
          }),
        );
        const compressed = compress(Buffer.from(await response.arrayBuffer()));
        outgoing.writeHead(response.status, {
          ...Object.fromEntries(response.headers),
          "content-encoding": encoding,
          "content-length": String(compressed.byteLength),
        });
        outgoing.end(compressed);
      })().catch(() => outgoing.destroy());
    });
    const transport = createSafeTransport(endpoint, { policy });
    context.onTestFinished(() => transport.close());
    await expect(
      createControlClient({
        endpoint,
        ...auth,
        fetch: transport.fetch,
        maxResponseBytes: CONTROL_MAX_RESPONSE_BYTES,
      }).getCapabilities(),
    ).resolves.toMatchObject({ product: { id: "transport-product" } });
    await expect(
      createControlClient({
        endpoint,
        ...auth,
        fetch: transport.fetch,
        maxResponseBytes: 32,
      }).getCapabilities(),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

test("never follows redirects or forwards signed headers to their target", async (context) => {
  vi.mocked(lookupAll).mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  let targetRequests = 0;
  const target = await serve(context, (_incoming, outgoing) => {
    targetRequests++;
    outgoing.end();
  });
  const endpoint = await serve(context, (_incoming, outgoing) => {
    outgoing.writeHead(307, { location: target });
    outgoing.end();
  });
  const transport = createSafeTransport(endpoint, { policy });
  context.onTestFinished(() => transport.close());
  await expect(
    createControlClient({
      endpoint,
      ...auth,
      fetch: transport.fetch,
    }).getCapabilities(),
  ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
  expect(transport.lastError?.code).toBe("REDIRECT_BLOCKED");
  expect(targetRequests).toBe(0);
});

test("the fixed endpoint transport rejects accidental retargeting", async (context) => {
  const endpoint = await serve(context, (_incoming, outgoing) =>
    outgoing.end(),
  );
  const transport = createSafeTransport(endpoint, { policy });
  context.onTestFinished(() => transport.close());
  await expect(
    transport.fetch("http://localhost:1/other", { method: "POST" }),
  ).rejects.toMatchObject({ code: "INVALID_ENDPOINT" });
  expect(lookup).not.toHaveBeenCalled();
});

test("bounds the whole response duration and cancels stalled sockets", async (context) => {
  vi.mocked(lookupAll).mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  let disconnected: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    disconnected = resolve;
  });
  const endpoint = await serve(context, (_incoming, outgoing) => {
    outgoing.writeHead(200, { "content-type": "application/json" });
    outgoing.write('{"ok":true,');
    outgoing.on("close", disconnected);
  });
  const transport = createSafeTransport(endpoint, { policy, timeoutMs: 40 });
  context.onTestFinished(() => transport.close());
  await expect(
    createControlClient({
      endpoint,
      ...auth,
      fetch: transport.fetch,
      timeoutMs: 500,
    }).getCapabilities(),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  expect(transport.lastError?.code).toBe("REQUEST_TIMEOUT");
  await closed;
});

test("caps concurrent connections and releases capacity after cancellation", async (context) => {
  vi.mocked(lookupAll).mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  const endpoint = await serve(context, (_incoming, outgoing) => {
    outgoing.writeHead(200, { "content-type": "application/json" });
    outgoing.write("{");
  });
  const transports = Array.from(
    { length: CONTROL_MAX_CONCURRENT_REQUESTS + 1 },
    () => createSafeTransport(endpoint, { policy }),
  );
  context.onTestFinished(() =>
    transports.forEach((transport) => transport.close()),
  );
  const responses = await Promise.all(
    transports
      .slice(0, CONTROL_MAX_CONCURRENT_REQUESTS)
      .map((transport) =>
        transport.fetch(endpoint, { method: "POST", body: "{}" }),
      ),
  );
  await expect(
    transports[CONTROL_MAX_CONCURRENT_REQUESTS].fetch(endpoint, {
      method: "POST",
      body: "{}",
    }),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  await Promise.all(responses.map((response) => response.body?.cancel()));
  // Cancellation propagates through the Node stream pipeline before releasing the slot.
  await new Promise<void>((resolve) => setImmediate(resolve));
  const response = await transports[CONTROL_MAX_CONCURRENT_REQUESTS].fetch(
    endpoint,
    { method: "POST", body: "{}" },
  );
  await response.body?.cancel();
});

test("rejects encoded response bodies above the transport byte limit", async (context) => {
  vi.mocked(lookupAll).mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  const endpoint = await serve(context, (_incoming, outgoing) => {
    outgoing.writeHead(200, { "content-type": "application/json" });
    outgoing.end("x".repeat(CONTROL_MAX_RESPONSE_BYTES + 1));
  });
  const transport = createSafeTransport(endpoint, { policy });
  context.onTestFinished(() => transport.close());
  await expect(
    createControlClient({
      endpoint,
      ...auth,
      fetch: transport.fetch,
      maxResponseBytes: CONTROL_MAX_RESPONSE_BYTES,
    }).getCapabilities(),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});

test("bounds hostile compressed expansion before a caller reads the response", async (context) => {
  vi.mocked(lookupAll).mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
  const compressed = gzipSync("x".repeat(CONTROL_MAX_RESPONSE_BYTES * 16));
  expect(compressed.byteLength).toBeLessThan(CONTROL_MAX_RESPONSE_BYTES);
  const endpoint = await serve(context, (_incoming, outgoing) => {
    outgoing.writeHead(200, {
      "content-type": "application/json",
      "content-encoding": "gzip",
    });
    outgoing.end(compressed);
  });
  const transport = createSafeTransport(endpoint, { policy });
  context.onTestFinished(() => transport.close());
  const response = await transport.fetch(endpoint, {
    method: "POST",
    body: "{}",
  });
  await expect(response.arrayBuffer()).rejects.toBeDefined();
  expect(transport.lastError?.code).toBe("ENDPOINT_UNAVAILABLE");
});
