import "server-only";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { PassThrough, Transform, pipeline } from "node:stream";
import { finished } from "node:stream/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { getEnv } from "@/lib/env";
import {
  EndpointError,
  resolveEndpoint,
  validateEndpoint,
  type EndpointPolicy,
} from "@/lib/security/endpoint";

export const CONTROL_REQUEST_TIMEOUT_MS = 5_000;
export const CONTROL_MAX_RESPONSE_BYTES = 262_144;
export const CONTROL_MAX_CONCURRENT_REQUESTS = 4;

let activeRequests = 0;

function boundedBody(): Transform {
  let receivedBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      receivedBytes += chunk.byteLength;
      done(
        receivedBytes > CONTROL_MAX_RESPONSE_BYTES
          ? new EndpointError("ENDPOINT_UNAVAILABLE")
          : null,
        chunk,
      );
    },
  });
}

export interface SafeTransport {
  fetch: typeof globalThis.fetch;
  readonly lastError: EndpointError | undefined;
  close(): void;
}

export function createSafeTransport(
  endpoint: string,
  options: {
    policy?: EndpointPolicy;
    timeoutMs?: number;
    onDispatch?: () => void;
  } = {},
): SafeTransport {
  const policy = options.policy ?? getEnv();
  const expectedEndpoint = validateEndpoint(endpoint, policy);
  const timeoutMs = options.timeoutMs ?? CONTROL_REQUEST_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > CONTROL_REQUEST_TIMEOUT_MS
  )
    throw new EndpointError("INVALID_ENDPOINT");
  const pending = new Set<AbortController>();
  let closed = false;
  let lastError: EndpointError | undefined;

  const safeFetch: typeof globalThis.fetch = async (
    input,
    init,
  ): Promise<Response> => {
    lastError = undefined;
    if (closed) throw new EndpointError("REQUEST_ABORTED");
    if (activeRequests >= CONTROL_MAX_CONCURRENT_REQUESTS) {
      lastError = new EndpointError("TOO_MANY_REQUESTS");
      throw lastError;
    }
    const request =
      input instanceof Request && init === undefined
        ? input
        : new Request(input, init);
    if (request.url !== expectedEndpoint || request.method !== "POST")
      throw new EndpointError("INVALID_ENDPOINT");
    activeRequests++;
    const controller = new AbortController();
    pending.add(controller);
    const rememberError = (error: unknown): EndpointError => {
      const safe =
        error instanceof EndpointError
          ? error
          : new EndpointError("ENDPOINT_UNAVAILABLE");
      lastError ??= safe;
      return safe;
    };
    const cancel = (): void =>
      controller.abort(new EndpointError("REQUEST_ABORTED"));
    request.signal.addEventListener("abort", cancel, { once: true });
    if (request.signal.aborted) cancel();
    const timer = setTimeout(
      () => controller.abort(new EndpointError("REQUEST_TIMEOUT")),
      timeoutMs,
    );
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      activeRequests--;
      clearTimeout(timer);
      request.signal.removeEventListener("abort", cancel);
      pending.delete(controller);
    };

    try {
      const destination = await resolveEndpoint(
        expectedEndpoint,
        controller.signal,
        policy,
      );
      const body = new Uint8Array(await request.arrayBuffer());
      if (controller.signal.aborted) throw controller.signal.reason;
      const pinnedLookup: LookupFunction = (
        _hostname,
        lookupOptions,
        callback,
      ): void => {
        // Connect to exactly the address checked above. Never perform a second DNS lookup.
        if (lookupOptions.all)
          callback(null, [
            { address: destination.address, family: destination.family },
          ]);
        else callback(null, destination.address, destination.family);
      };
      const headers = Object.fromEntries(request.headers.entries());
      // These transport headers are not part of the SDK's signed protocol fields.
      delete headers.host;
      delete headers.connection;
      headers["accept-encoding"] = "gzip, deflate, br";
      headers["content-length"] = String(body.byteLength);
      return await new Promise<Response>((resolve, reject) => {
        const fail = (error: unknown): void => {
          release();
          reject(
            rememberError(
              controller.signal.aborted ? controller.signal.reason : error,
            ),
          );
        };
        const send =
          destination.url.protocol === "https:" ? httpsRequest : httpRequest;
        // The URL hostname remains intact for Host, TLS SNI and certificate validation.
        // No agent/pooling means each attempt resolves, checks and pins its own connection.
        const outgoing = send(
          destination.url,
          {
            method: request.method,
            headers,
            lookup: pinnedLookup,
            family: destination.family,
            agent: false,
            maxHeaderSize: 16_384,
            signal: controller.signal,
          },
          (incoming) => {
            const status = incoming.statusCode ?? 0;
            if (status >= 300 && status <= 399) {
              incoming.destroy();
              outgoing.destroy();
              fail(new EndpointError("REDIRECT_BLOCKED"));
              return;
            }
            const responseHeaders = new Headers();
            for (const [name, value] of Object.entries(incoming.headers)) {
              if (Array.isArray(value))
                value.forEach((entry) => responseHeaders.append(name, entry));
              else if (value !== undefined) responseHeaders.set(name, value);
            }
            const encoding = responseHeaders
              .get("content-encoding")
              ?.toLowerCase()
              .trim();
            const decoder =
              encoding === "gzip"
                ? createGunzip()
                : encoding === "deflate"
                  ? createInflate()
                  : encoding === "br"
                    ? createBrotliDecompress()
                    : undefined;
            if (
              (encoding && encoding !== "identity" && !decoder) ||
              status < 200 ||
              status > 599
            ) {
              incoming.destroy();
              outgoing.destroy();
              fail(new EndpointError("ENDPOINT_UNAVAILABLE"));
              return;
            }
            const boundEncodedBody = boundedBody();
            const stream = new PassThrough();
            const completed = (error: NodeJS.ErrnoException | null): void => {
              if (error && !released)
                rememberError(
                  controller.signal.aborted ? controller.signal.reason : error,
                );
              release();
            };
            if (decoder) {
              responseHeaders.delete("content-encoding");
              responseHeaders.delete("content-length");
              pipeline(
                incoming,
                boundEncodedBody,
                decoder,
                boundedBody(),
                stream,
                completed,
              );
            } else {
              pipeline(incoming, boundEncodedBody, stream, completed);
            }
            // Bound buffering in bytes even before SDK parsing starts. Its own parsing
            // limit remains authoritative; cancellation propagates back to the socket.
            const iterator = stream[Symbol.asyncIterator]();
            let canceled = false;
            const responseBody = new ReadableStream<Uint8Array>(
              {
                async pull(webController): Promise<void> {
                  try {
                    const next: IteratorResult<Buffer> = await iterator.next();
                    if (canceled) return;
                    if (next.done) webController.close();
                    else webController.enqueue(next.value);
                  } catch (error: unknown) {
                    if (!canceled) webController.error(rememberError(error));
                  }
                },
                async cancel(): Promise<void> {
                  canceled = true;
                  stream.destroy();
                  await finished(stream).catch(() => undefined);
                  release();
                },
              },
              {
                highWaterMark: 16_384,
                size: (chunk): number => chunk.byteLength,
              },
            );
            try {
              resolve(
                new Response(
                  [204, 205, 304].includes(status) ? null : responseBody,
                  { status, headers: responseHeaders },
                ),
              );
              if ([204, 205, 304].includes(status)) stream.destroy();
            } catch (error: unknown) {
              stream.destroy();
              fail(error);
            }
          },
        );
        outgoing.once("error", fail);
        options.onDispatch?.();
        outgoing.end(body);
      });
    } catch (error: unknown) {
      release();
      throw rememberError(
        controller.signal.aborted ? controller.signal.reason : error,
      );
    }
  };

  return {
    fetch: safeFetch,
    get lastError(): EndpointError | undefined {
      return lastError;
    },
    close(): void {
      closed = true;
      for (const controller of pending)
        controller.abort(new EndpointError("REQUEST_ABORTED"));
    },
  };
}
