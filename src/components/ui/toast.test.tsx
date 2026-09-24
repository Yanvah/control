// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./toast";

function ToastTriggers(): React.JSX.Element {
  const { toast } = useToast();
  return (
    <div>
      <button
        type="button"
        onClick={() => toast({ title: "First change", variant: "success" })}
      >
        First
      </button>
      <button
        type="button"
        onClick={() => toast({ title: "Second change", variant: "success" })}
      >
        Second
      </button>
    </div>
  );
}

describe("toast notifications", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("stacks notices and removes them after their exit animation", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastTriggers />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "First" }));
    fireEvent.click(screen.getByRole("button", { name: "Second" }));
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.getAllByRole("status")[1]).toHaveTextContent("Second change");

    act(() => vi.advanceTimersByTime(5_000));
    for (const notice of screen.getAllByRole("status"))
      expect(notice).toHaveClass("toast-exit");
    act(() => vi.advanceTimersByTime(180));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("can be dismissed immediately", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastTriggers />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "First" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    expect(screen.getByRole("status")).toHaveClass("toast-exit");
    act(() => vi.advanceTimersByTime(180));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
