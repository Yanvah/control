import "server-only";
import { auditOutcome } from "@/lib/audit/context";
import { z } from "zod";
import { getEnv } from "@/lib/env";

export class RequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export function requireSameOrigin(request: Request): void {
  const expected = new URL(getEnv().CONTROL_URL).origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    origin !== expected ||
    (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none")
  ) {
    throw new RequestError(403, "INVALID_ORIGIN");
  }
}

export function requireSameOriginRead(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin !== null) return requireSameOrigin(request);
  if (request.headers.get("sec-fetch-site") !== "same-origin") {
    throw new RequestError(403, "INVALID_ORIGIN");
  }
}

export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = 16_384,
): Promise<T> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    throw new RequestError(415, "JSON_REQUIRED");
  }
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^(0|[1-9][0-9]*)$/.test(declaredLength) ||
      !Number.isSafeInteger(Number(declaredLength)))
  ) {
    throw new RequestError(400, "INVALID_REQUEST");
  }
  if (declaredLength !== null && Number(declaredLength) > maxBytes)
    throw new RequestError(413, "REQUEST_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "INVALID_REQUEST");
  let size = 0;
  const chunks: Uint8Array[] = [];
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const deadline = performance.now() + 10_000;
  // Byte limits alone do not stop a client from holding a body stream open.
  const canceled = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new RequestError(408, "REQUEST_TIMEOUT")),
      10_000,
    );
    abort = () => reject(new RequestError(400, "REQUEST_ABORTED"));
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
  });
  try {
    while (true) {
      if (performance.now() >= deadline)
        throw new RequestError(408, "REQUEST_TIMEOUT");
      const result = await Promise.race([canceled, reader.read()]);
      if (result.done) {
        finished = true;
        break;
      }
      size += result.value.byteLength;
      if (size > maxBytes) throw new RequestError(413, "REQUEST_TOO_LARGE");
      chunks.push(result.value);
    }
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "INVALID_REQUEST");
  } finally {
    clearTimeout(timer);
    if (abort) request.signal.removeEventListener("abort", abort);
    // Cleanup must not wait on a stalled or rejecting stream cancellation hook.
    if (!finished) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (declaredLength !== null && size !== Number(declaredLength))
    throw new RequestError(400, "INVALID_REQUEST");
  let input: unknown;
  try {
    // Reject malformed UTF-8 instead of changing identifiers or secrets on decode.
    input = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    throw new RequestError(400, "INVALID_REQUEST");
  }
  const result = schema.safeParse(input);
  if (!result.success) throw new RequestError(400, "INVALID_REQUEST");
  return result.data;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function requestErrorResponse(error: unknown): Response {
  if (error instanceof RequestError) {
    auditOutcome("failed", error.code);
    const response = jsonResponse({ error: error.code }, error.status);
    if (error.status === 429) response.headers.set("Retry-After", "60");
    return response;
  }
  auditOutcome("unknown", "REQUEST_FAILED");
  return jsonResponse({ error: "REQUEST_FAILED" }, 500);
}
