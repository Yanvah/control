"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  action?: { label: string; href: string };
  duration?: number;
}

type ToastRecord = ToastInput & {
  id: string;
  phase: "open" | "closing";
  variant: ToastVariant;
};

type ToastContextValue = {
  toast(input: ToastInput): string;
  dismiss(id: string): void;
};

const ToastContext = createContext<ToastContextValue | null>(null);
const DEFAULT_DURATION_MS = 5_000;
const EXIT_DURATION_MS = 180;

export function ToastProvider({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const sequence = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>[]>());

  const clearTimers = useCallback((id: string): void => {
    for (const timer of timers.current.get(id) ?? []) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const remove = useCallback(
    (id: string): void => {
      clearTimers(id);
      setToasts((current) => current.filter((item) => item.id !== id));
    },
    [clearTimers],
  );

  const dismiss = useCallback(
    (id: string): void => {
      clearTimers(id);
      setToasts((current) =>
        current.map((item) =>
          item.id === id ? { ...item, phase: "closing" } : item,
        ),
      );
      const timer = setTimeout(() => remove(id), EXIT_DURATION_MS);
      timers.current.set(id, [timer]);
    },
    [clearTimers, remove],
  );

  const toast = useCallback(
    (input: ToastInput): string => {
      const id = `toast-${++sequence.current}`;
      const record: ToastRecord = {
        ...input,
        id,
        phase: "open",
        variant: input.variant ?? "info",
      };
      setToasts((current) => [...current, record]);
      const timer = setTimeout(
        () => dismiss(id),
        input.duration ?? DEFAULT_DURATION_MS,
      );
      timers.current.set(id, [timer]);
      return id;
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      for (const entries of timers.current.values())
        for (const timer of entries) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-4 top-4 z-[100] flex flex-col items-stretch gap-3 sm:right-5 sm:left-auto sm:w-full sm:max-w-sm"
      >
        {toasts.map((item) => (
          <ToastItem key={item.id} toast={item} dismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  dismiss,
}: {
  toast: ToastRecord;
  dismiss(id: string): void;
}): React.JSX.Element {
  const Icon =
    toast.variant === "success"
      ? CheckCircle2
      : toast.variant === "error"
        ? CircleAlert
        : Info;
  return (
    <div
      role={toast.variant === "error" ? "alert" : "status"}
      aria-atomic="true"
      className={cn(
        "pointer-events-auto grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-lg border bg-popover p-4 shadow-2xl shadow-black/35",
        toast.variant === "error"
          ? "border-destructive/35"
          : "border-primary/30",
        toast.phase === "open" ? "toast-enter" : "toast-exit",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-5 shrink-0",
          toast.variant === "error" ? "text-destructive" : "text-primary",
        )}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{toast.title}</p>
        {toast.description && (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {toast.description}
          </p>
        )}
        {toast.action && (
          <a
            href={toast.action.href}
            className="mt-2 inline-block text-xs font-medium text-primary underline underline-offset-4"
          >
            {toast.action.label}
          </a>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => dismiss(toast.id)}
        className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider.");
  return context;
}
