import "server-only";
import { RequestError } from "@/lib/security/request";

type Search = {
  sequence: number;
  controller: AbortController;
  touched: number;
};
const state = globalThis as typeof globalThis & {
  controlUserSearches?: Map<string, Search>;
};
const searches = (state.controlUserSearches ??= new Map<string, Search>());

export function beginSearch(
  sessionId: string,
  channelId: string,
  sequence: number,
  signal: AbortSignal,
): { signal: AbortSignal; close(): void } {
  const now = Date.now();
  for (const [key, value] of searches)
    if (now - value.touched > 300_000) {
      value.controller.abort();
      searches.delete(key);
    }
  const key = `${sessionId}:${channelId}`;
  const previous = searches.get(key);
  if (previous && sequence <= previous.sequence)
    throw new RequestError(409, "SEARCH_REPLACED");
  if (!previous && searches.size >= 32)
    throw new RequestError(429, "CONNECTION_LIMIT");
  previous?.controller.abort();
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  searches.set(key, { sequence, controller, touched: now });
  return {
    signal: controller.signal,
    // Retain the sequence until expiry so a late request cannot revive an older search.
    close: () => signal.removeEventListener("abort", abort),
  };
}
