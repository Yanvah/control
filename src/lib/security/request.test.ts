import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { readJson } from "./request";

const schema = z.strictObject({ value: z.string() });

function request(
  body: BodyInit,
  options: { headers?: HeadersInit; signal?: AbortSignal } = {},
): Request {
  const headers = new Headers(options.headers);
  if (!headers.has("content-type"))
    headers.set("content-type", "application/json");
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    body,
    headers,
    signal: options.signal,
    duplex: "half",
  };
  return new Request("https://control.example.test/api/setup", init);
}

afterEach(() => vi.useRealTimers());

describe("browser JSON request boundaries", () => {
  it("accepts UTF-8 JSON within the byte limit and releases the reader", async () => {
    const body = JSON.stringify({ value: "café" });
    const input = request(body, {
      headers: {
        "content-type": "Application/JSON; charset=utf-8",
        "content-length": String(Buffer.byteLength(body)),
      },
    });
    await expect(
      readJson(input, schema, Buffer.byteLength(body)),
    ).resolves.toEqual({ value: "café" });
    expect(input.body?.locked).toBe(false);
  });

  it.each(["-1", "1.5", "unknown", "9007199254740992", "1"])(
    "rejects invalid or mismatched Content-Length %s",
    async (length) => {
      await expect(
        readJson(
          request('{"value":"ok"}', { headers: { "content-length": length } }),
          schema,
        ),
      ).rejects.toMatchObject({ status: 400, code: "INVALID_REQUEST" });
    },
  );

  it("counts streamed bytes even when the client omits Content-Length", async () => {
    const cancel = vi.fn();
    const input = request(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"value":"'));
          controller.enqueue(new TextEncoder().encode('too long"}'));
        },
        cancel,
      }),
    );
    await expect(readJson(input, schema, 12)).rejects.toMatchObject({
      status: 413,
      code: "REQUEST_TOO_LARGE",
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(input.body?.locked).toBe(false);
  });

  it("rejects invalid UTF-8 rather than substituting characters in a value", async () => {
    const body = Buffer.concat([
      Buffer.from('{"value":"'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}'),
    ]);
    await expect(readJson(request(body), schema)).rejects.toMatchObject({
      status: 400,
      code: "INVALID_REQUEST",
    });
  });

  it.each(['{"value":42}', '{"value":"ok","extra":true}', '{"value":'])(
    "rejects invalid JSON or schema input %s",
    async (body) => {
      await expect(readJson(request(body), schema)).rejects.toMatchObject({
        status: 400,
        code: "INVALID_REQUEST",
      });
    },
  );

  it("stops a stalled read even if the stream's cancellation never settles", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const input = request(new ReadableStream({ cancel }));
    const result = expect(readJson(input, schema)).rejects.toMatchObject({
      status: 408,
      code: "REQUEST_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(cancel).toHaveBeenCalledOnce();
    expect(input.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors request cancellation before and during a read", async () => {
    const before = new AbortController();
    before.abort();
    await expect(
      readJson(request('{"value":"ok"}', { signal: before.signal }), schema),
    ).rejects.toMatchObject({ code: "REQUEST_ABORTED" });

    const during = new AbortController();
    const input = request(new ReadableStream(), { signal: during.signal });
    const result = expect(readJson(input, schema)).rejects.toMatchObject({
      code: "REQUEST_ABORTED",
    });
    during.abort();
    await result;
    expect(input.body?.locked).toBe(false);
  });

  it("sanitizes stream failures without retaining the reader lock", async () => {
    const input = request(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("private transport details"));
        },
      }),
    );
    await expect(readJson(input, schema)).rejects.toMatchObject({
      status: 400,
      code: "INVALID_REQUEST",
    });
    expect(input.body?.locked).toBe(false);
  });
});
