import { describe, expect, it } from "vitest";
import { acquireOperationSlot } from "./slots";

describe("shared operation concurrency slots", () => {
  it("limits in-flight work to four, queues new work, and releases canceled waiters", async () => {
    const controller = new AbortController();
    const leases = await Promise.all(
      Array.from({ length: 4 }, () => acquireOperationSlot(controller.signal)),
    );
    let granted = false;
    const queued = acquireOperationSlot(controller.signal).then((release) => {
      granted = true;
      return release;
    });
    await Promise.resolve();
    expect(granted).toBe(false);
    leases[0]();
    const release = await queued;
    expect(granted).toBe(true);
    const canceled = new AbortController();
    const waiting = acquireOperationSlot(canceled.signal);
    canceled.abort();
    await expect(waiting).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    release();
    leases.forEach((finish) => finish());
    const final = await acquireOperationSlot(new AbortController().signal);
    final();
  });
});
