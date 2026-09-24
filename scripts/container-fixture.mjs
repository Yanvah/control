// Disposable test service. Never copy this file into the production image.
import { readFileSync } from "node:fs";
import { request as proxyRequest } from "node:http";
import { createServer } from "node:https";
import {
  createControlHandler,
  createMemoryReplayStore,
} from "@yanvah/control/server";

const products = new Map();
for (const id of ["a", "b"]) {
  const user = {
    id: "user_container",
    email: "container-user@example.test",
    name: `Container ${id.toUpperCase()}`,
    banned: false,
  };
  const state = { user, mutations: 0 };
  const handler = createControlHandler({
    product: {
      id: `container-${id}`,
      name: `Container SaaS ${id.toUpperCase()}`,
    },
    auth: {
      keyId: `container_${id}`,
      secret: process.env[`FIXTURE_SECRET_${id.toUpperCase()}`],
    },
    replayStore: createMemoryReplayStore(),
    users: {
      search: ({ query }) => (user.email.includes(query) ? [{ ...user }] : []),
      get: ({ userId }) => (userId === user.id ? { ...user } : null),
      ...(id === "a"
        ? {
            ban: () => {
              user.banned = true;
              state.mutations++;
            },
          }
        : {}),
    },
  });
  products.set(`/saas/${id}`, { handler, state });
}

const server = createServer(
  {
    key: readFileSync("/fixtures/key.pem"),
    cert: readFileSync("/fixtures/cert.pem"),
  },
  (incoming, outgoing) => {
    if (incoming.url === "/fixture/state") {
      outgoing.setHeader("content-type", "application/json");
      outgoing.end(
        JSON.stringify(
          Object.fromEntries(
            [...products].map(([route, product]) => [route, product.state]),
          ),
        ),
      );
      return;
    }
    const product = products.get(incoming.url);
    if (!product) {
      const proxy = proxyRequest(
        {
          hostname: "control",
          port: 3000,
          path: incoming.url,
          method: incoming.method,
          headers: { ...incoming.headers, host: "control:3000" },
        },
        (response) => {
          outgoing.writeHead(response.statusCode, response.headers);
          response.pipe(outgoing);
        },
      );
      proxy.on("error", () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.on("aborted", () => proxy.destroy());
      incoming.pipe(proxy);
      return;
    }
    void (async () => {
      const chunks = [];
      let length = 0;
      for await (const chunk of incoming) {
        length += chunk.length;
        if (length > 65_536) throw new Error("Fixture input too large.");
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value))
          value.forEach((entry) => headers.append(key, entry));
        else if (value !== undefined) headers.set(key, value);
      }
      const response = await product.handler(
        new Request(`https://fixture:3443${incoming.url}`, {
          method: incoming.method,
          headers,
          body: Buffer.concat(chunks),
        }),
      );
      outgoing.statusCode = response.status;
      response.headers.forEach((value, key) => outgoing.setHeader(key, value));
      outgoing.end(new Uint8Array(await response.arrayBuffer()));
    })().catch(() => {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
    });
  },
);
server.listen(3443, "0.0.0.0");
