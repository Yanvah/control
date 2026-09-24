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
import { ToastProvider } from "@/components/ui/toast";
import { SecuritySettings } from "./security-settings";

const { refresh, addPasskey } = vi.hoisted(() => ({
  refresh: vi.fn(),
  addPasskey: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/auth/client", () => ({
  authClient: { passkey: { addPasskey } },
}));

const sessions = [
  {
    id: "current-session",
    createdAt: new Date("2026-09-20T10:00:00Z"),
    expiresAt: new Date("2026-09-27T10:00:00Z"),
    ipAddress: null,
    userAgent: "Chrome/120 Macintosh",
    current: true,
  },
  {
    id: "other-session",
    createdAt: new Date("2026-09-19T10:00:00Z"),
    expiresAt: new Date("2026-09-26T10:00:00Z"),
    ipAddress: null,
    userAgent: "Firefox/120 Linux",
    current: false,
  },
];

function renderSettings(
  passkeys: React.ComponentProps<typeof SecuritySettings>["passkeys"] = [],
): void {
  render(
    <ToastProvider>
      <SecuritySettings passkeys={passkeys} sessions={sessions} />
    </ToastProvider>,
  );
}

describe("security settings", () => {
  const request = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", request);
    request.mockReset();
    refresh.mockReset();
    addPasskey.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(["server error", "lost response"])(
    "does not claim enrollment failed or retry after a %s",
    async (failure) => {
      if (failure === "server error")
        addPasskey.mockResolvedValue({ error: { status: 503 } });
      else addPasskey.mockRejectedValue(new Error("Connection lost"));
      renderSettings();
      fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not confirm passkey enrollment",
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "check your passkeys before trying again",
      );
      expect(addPasskey).toHaveBeenCalledOnce();
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  it("requires explicit confirmation and never offers to revoke the current session", async () => {
    request.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    renderSettings();
    expect(
      screen.getAllByRole("button", { name: "Revoke session" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Revoke session" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Firefox · Linux/)).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke session" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Revoke session",
      }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledExactlyOnceWith("/api/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "other-session" }),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Session revoked",
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("offers fresh authentication when the server rejects a stale security change", async () => {
    request.mockResolvedValue(
      new Response(
        JSON.stringify({ error: "RECENT_AUTHENTICATION_REQUIRED" }),
        { status: 403 },
      ),
    );
    renderSettings([
      {
        id: "passkey-id",
        name: "Travel key",
        createdAt: new Date("2026-09-20T10:00:00Z"),
        deviceType: "singleDevice",
        backedUp: false,
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Travel key" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Remove passkey",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Recent sign-in required",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Confirm your identity before changing account security",
    );
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      "/login?reauth=1&next=/settings",
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("reports an uncertain outcome when the server fails after a security change", async () => {
    request.mockResolvedValue(
      Response.json({ error: "AUDIT_UNAVAILABLE" }, { status: 503 }),
    );
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Revoke session" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Revoke session",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not confirm the change",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "check the current state before trying again",
    );
    expect(
      screen.queryByText("Change was not completed"),
    ).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  });
});
