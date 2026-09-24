// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { SettingsWelcomeToast } from "./settings-welcome-toast";

describe("settings welcome toast", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
  });

  it("appears once under React Strict Mode", () => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/settings?welcome=1");
    render(
      <StrictMode>
        <ToastProvider>
          <SettingsWelcomeToast />
        </ToastProvider>
      </StrictMode>,
    );
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your instance is ready",
    );
  });
});
