// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { randomBytes } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddProductForm } from "./add-product-form";
import { ProductActions } from "./product-actions";
import { ProductsTable } from "./products-table";
import { CapabilityInspection } from "./capability-inspection";
import type { ProductView } from "@/lib/products/types";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const product: ProductView = {
  id: "0583dfee-3774-48a4-855f-8eb2ff6d28dc",
  name: "Product Alpha",
  endpoint: "https://alpha.example/api/control",
  enabled: true,
  keyId: "alpha-key",
  status: "unknown",
  capabilities: null,
  lastConnectedAt: null,
  lastTestedAt: null,
  lastErrorCode: null,
  createdAt: "2026-09-20T12:00:00.000Z",
  updatedAt: "2026-09-20T12:00:00.000Z",
};

describe("product management UI", () => {
  const request = vi.fn<typeof fetch>();
  beforeEach(() => {
    request.mockReset();
    router.replace.mockReset();
    router.refresh.mockReset();
    vi.stubGlobal("fetch", request);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("requires typed product confirmation and submits removal only once while pending", async () => {
    let finish: (response: Response) => void = () => {
      throw new Error("request not started");
    };
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<ProductActions product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove product" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(product.endpoint)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", {
      name: "Remove product",
    });
    expect(confirm).toBeDisabled();
    expect(request).not.toHaveBeenCalled();
    fireEvent.change(
      within(dialog).getByLabelText("Type the product name to confirm"),
      { target: { value: "wrong product" } },
    );
    expect(confirm).toBeDisabled();
    fireEvent.change(
      within(dialog).getByLabelText("Type the product name to confirm"),
      { target: { value: product.name } },
    );
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(request).toHaveBeenCalledExactlyOnceWith(
      `/api/products/${product.id}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: product.name }),
      },
    );
    finish(new Response(JSON.stringify({ ok: true })));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/products"),
    );
  });

  it("requires acknowledgement before discarding a generated credential and never stores it in browser storage", async () => {
    const secret = randomBytes(32).toString("base64url");
    request.mockResolvedValue(
      new Response(
        JSON.stringify({ product, credentials: { keyId: "new-key", secret } }),
        { status: 201 },
      ),
    );
    const store = vi.spyOn(Storage.prototype, "setItem");
    render(<AddProductForm />);
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: product.name },
    });
    fireEvent.change(screen.getByLabelText("Endpoint URL"), {
      target: { value: product.endpoint },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    expect(await screen.findByLabelText("Generated shared secret")).toHaveValue(
      secret,
    );
    expect(
      screen.getByText(/only time Control can show this secret/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue to product" }),
    ).toBeDisabled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Saved the credential safely/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to product" }),
    );
    expect(
      screen.queryByLabelText("Generated shared secret"),
    ).not.toBeInTheDocument();
    expect(router.replace).toHaveBeenCalledWith(`/products/${product.id}`);
    expect(request).toHaveBeenCalledOnce();
  });

  it("offers a safe return to the product after fresh authentication", async () => {
    request.mockResolvedValue(
      new Response(
        JSON.stringify({ error: "RECENT_AUTHENTICATION_REQUIRED" }),
        { status: 403 },
      ),
    );
    render(<ProductActions product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Disable product" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Disable product",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in again");
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      `/login?reauth=1&next=${encodeURIComponent(`/products/${product.id}`)}`,
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("reports a lost mutation response as unknown and never retries it", async () => {
    request.mockRejectedValue(new Error("private network diagnostic"));
    render(<ProductActions product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Disable product" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Disable product",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Outcome unknown",
    );
    expect(
      screen.queryByText(/private network diagnostic/),
    ).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledOnce();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("filters the real TanStack table and leaves disabled status explicit", () => {
    render(
      <ProductsTable
        products={[
          product,
          {
            ...product,
            id: "b",
            name: "Product Beta",
            endpoint: "https://beta.example/control",
            enabled: false,
          },
        ]}
      />,
    );
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Filter products" }), {
      target: { value: "beta.example" },
    });
    expect(screen.queryByText("Product Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Product Beta")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 products")).toBeInTheDocument();
  });

  it("renders remote action text literally and provides no action execution buttons", () => {
    const unsafeLabel = "<img src=x onerror=alert(1)>";
    const { container } = render(
      <CapabilityInspection
        product={{
          ...product,
          capabilities: {
            product: { id: "remote-alpha", name: "Remote Alpha" },
            protocolVersion: "1",
            sdkVersion: "0.1.0",
            operations: ["system.capabilities", "actions.invoke"],
            actions: [
              {
                id: "dangerous-action",
                label: unsafeLabel,
                description: "<script>never execute</script>",
                risk: "dangerous",
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText(unsafeLabel)).toBeInTheDocument();
    expect(container.querySelector("img, script")).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByText(/last successfully discovered capabilities/),
    ).toBeInTheDocument();
  });
});
