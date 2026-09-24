import "server-only";
import { RequestError } from "@/lib/security/request";

type Waiter = { grant(): void };
const state = globalThis as typeof globalThis & {
  controlOperationSlots?: { count: number; queue: Waiter[] };
};
const slots = (state.controlOperationSlots ??= { count: 0, queue: [] });

function lease(): () => void {
  slots.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    slots.count--;
    slots.queue.shift()?.grant();
  };
}

export async function acquireOperationSlot(
  signal: AbortSignal,
): Promise<() => void> {
  if (signal.aborted) throw new RequestError(409, "REQUEST_ABORTED");
  if (slots.count < 4) return lease();
  if (slots.queue.length >= 64) throw new RequestError(429, "CONNECTION_LIMIT");
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const fail = (code: string): void => {
      const index = slots.queue.indexOf(waiter);
      if (index !== -1) slots.queue.splice(index, 1);
      cleanup();
      reject(new RequestError(409, code));
    };
    const abort = (): void => fail("REQUEST_ABORTED");
    const waiter: Waiter = {
      grant: () => {
        cleanup();
        resolve(lease());
      },
    };
    const timer = setTimeout(() => fail("CONNECTION_LIMIT"), 15_000);
    signal.addEventListener("abort", abort, { once: true });
    slots.queue.push(waiter);
  });
}
