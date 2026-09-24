// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupForm } from "./setup-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signIn: { email: vi.fn() } },
}));

describe("setup form", () => {
  const request = vi.fn<typeof fetch>();

  beforeEach(() => {
    request.mockReset();
    vi.stubGlobal("fetch", request);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("explains an exact-origin rejection without exposing request details", async () => {
    request.mockResolvedValue(
      Response.json({ error: "INVALID_ORIGIN" }, { status: 403 }),
    );
    render(<SetupForm />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Local Owner" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "a-secure-local-password" },
    });
    fireEvent.change(screen.getByLabelText("Setup token"), {
      target: { value: "test-setup-token" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create owner account" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This page is not using the configured CONTROL_URL",
    );
    expect(request).toHaveBeenCalledOnce();
  });
});
