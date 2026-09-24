// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MutationPanel } from "@/components/actions/mutation-panel";
import { JsonResult } from "@/components/actions/json-result";
import { UserSearch } from "./user-search";
import type { UserDetail } from "@/lib/users/models";

const productId = "b33b83e8-e750-4913-ad35-559c4bdb5c2f";
const detail: UserDetail = {
  product: { id: productId, name: "Atlas" },
  capabilityVersion: "a".repeat(64),
  capabilities: {
    product: { id: "atlas", name: "Atlas SaaS" },
    sdkVersion: "0.1.0",
    protocolVersion: "1",
    operations: [
      "system.capabilities",
      "users.get",
      "users.ban",
      "actions.invoke",
    ],
    actions: [
      {
        id: "grant",
        label: "Grant credit",
        description: "Grant credits to the specified account.",
        risk: "dangerous",
      },
    ],
  },
  user: {
    state: "ready",
    data: { id: "user_123", email: "john@example.com", banned: false },
  },
  subscription: { state: "unsupported", code: "OPERATION_UNSUPPORTED" },
};
const refresh = vi.fn<() => Promise<boolean>>();
const request = vi.fn<typeof fetch>();
beforeEach(() => {
  request.mockReset();
  refresh.mockReset().mockResolvedValue(true);
  vi.stubGlobal("fetch", request);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function panel(input: UserDetail = detail): void {
  render(
    <MutationPanel
      detail={input}
      userId="user_123"
      destination={`/users/${productId}?userId=user_123`}
      refresh={refresh}
    />,
  );
}
async function confirmBan(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Ban user" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.change(within(dialog).getByLabelText("Type user_123 to confirm"), {
    target: { value: "user_123" },
  });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Confirm operation" }),
  );
}

describe("confirmed operation interaction", () => {
  it("renders only advertised operations and automatically renders new action metadata", () => {
    panel({
      ...detail,
      capabilities: {
        ...detail.capabilities!,
        operations: ["system.capabilities", "actions.invoke"],
        actions: [
          {
            id: "new-action",
            label: "New <action>",
            description: "<script>unsafe text</script>",
            risk: "safe",
          },
        ],
      },
    });
    expect(
      screen.queryByRole("button", { name: "Ban user" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Run New <action>" }),
    ).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });
  it("requires typed confirmation and prevents duplicate submissions while awaiting a response", async () => {
    let finish: (response: Response) => void = () => {};
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Ban user" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("Atlas", { exact: true }),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    const confirm = within(dialog).getByRole("button", {
      name: "Confirm operation",
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(
      within(dialog).getByLabelText("Type user_123 to confirm"),
      { target: { value: "user_123" } },
    );
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(request).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
    const body = JSON.parse(String(request.mock.calls[0][1]?.body)) as {
      attemptId: string;
      operation: string;
      input: unknown;
    };
    expect(body).toMatchObject({
      operation: "users.ban",
      input: { userId: "user_123" },
    });
    finish(
      new Response(
        JSON.stringify({
          attemptId: body.attemptId,
          state: "succeeded",
          code: null,
          requestId: "sdk-request",
        }),
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "Operation succeeded" }),
    ).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("shows a lost response as unknown, does not retry or refresh, and can check a receipt with GET", async () => {
    request.mockRejectedValueOnce(new Error("private network detail"));
    panel();
    await confirmBan();
    expect(
      await screen.findByRole("heading", { name: "Outcome unknown" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("private network detail"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ban user" })).toBeDisabled();
    expect(refresh).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
    const { attemptId } = JSON.parse(
      String(request.mock.calls[0][1]?.body),
    ) as { attemptId: string };
    request.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          attemptId,
          state: "succeeded",
          code: null,
          requestId: "sdk-request",
        }),
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Check recorded outcome" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Operation succeeded" }),
    ).toBeInTheDocument();
    expect(request.mock.calls[1]).toEqual([
      `/api/operations/${attemptId}`,
      { cache: "no-store" },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("keeps dangerous custom action parameters visible and rejects unsafe JSON structure", async () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Run Grant credit" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Product: Atlas")).toBeInTheDocument();
    fireEvent.change(
      within(dialog).getByLabelText("Action parameters (JSON)"),
      { target: { value: '{"__proto__":{"admin":true}}' } },
    );
    fireEvent.change(within(dialog).getByLabelText("Type Atlas to confirm"), {
      target: { value: "Atlas" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm operation" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Check the parameters",
    );
    expect(request).not.toHaveBeenCalled();
  });
  it("caps a large validated JSON result preview", () => {
    const { container } = render(
      <JsonResult value={{ text: "x".repeat(100_000) }} />,
    );
    expect(screen.getByText(/preview limited/)).toBeInTheDocument();
    expect(container.querySelector("pre")?.textContent?.length).toBe(32_768);
  });
  it("discards a stale search response even when a transport ignores cancellation", async () => {
    const finishes: ((response: Response) => void)[] = [];
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve);
        }),
    );
    render(<UserSearch />);
    const input = screen.getByLabelText("Email, name, or user ID");
    fireEvent.change(input, { target: { value: "old" } });
    fireEvent.click(screen.getByRole("button", { name: "Search users" }));
    fireEvent.change(input, { target: { value: "new" } });
    fireEvent.click(screen.getByRole("button", { name: "Search again" }));
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    finishes[1](
      new Response(
        JSON.stringify({
          results: [
            {
              product: { id: productId, name: "New product" },
              state: "not_found",
            },
          ],
        }),
      ),
    );
    expect(await screen.findByText("New product")).toBeInTheDocument();
    finishes[0](
      new Response(
        JSON.stringify({
          results: [
            {
              product: { id: productId, name: "Stale product" },
              state: "not_found",
            },
          ],
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("Stale product")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("New product")).toBeInTheDocument();
  });
});
