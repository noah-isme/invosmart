"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type ToastVariant = "default" | "success" | "error";

type ToastMessage = {
  title: string;
  description?: string;
  variant?: ToastVariant;
};

type ToastRecord = ToastMessage & { id: number };

type ToastContextValue = {
  notify: (toast: ToastMessage) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const variantClassName: Record<ToastVariant, string> = {
  default: "border-white/10 bg-white/10 text-text",
  success: "border-emerald-400/40 bg-emerald-500/15 text-emerald-50",
  error: "border-rose-400/40 bg-rose-500/15 text-rose-50",
};

const AUTO_DISMISS_MS = 4000;

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const idRef = useRef(0);
  const timeouts = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    const timers = timeouts.current;

    return () => {
      timers.forEach((timeout) => {
        window.clearTimeout(timeout);
      });
      timers.clear();
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timeout = timeouts.current.get(id);
    if (timeout) {
      window.clearTimeout(timeout);
      timeouts.current.delete(id);
    }
  }, []);

  const notify = useCallback<ToastContextValue["notify"]>(
    (toast) => {
      const id = ++idRef.current;
      const record: ToastRecord = { id, ...toast };
      setToasts((current) => [...current, record]);

      const timeout = window.setTimeout(() => {
        dismiss(id);
      }, AUTO_DISMISS_MS);

      timeouts.current.set(id, timeout);

      return id;
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({ notify, dismiss }),
    [dismiss, notify],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-3 pb-6"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto w-[min(90%,420px)] rounded-2xl border px-4 py-3 shadow-lg backdrop-blur ${
              variantClassName[toast.variant ?? "default"]
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.description ? (
                  <p className="text-xs opacity-80">{toast.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="text-xs font-medium uppercase tracking-wide text-current/60 transition hover:text-current"
              >
                Tutup
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast harus digunakan di dalam ToastProvider");
  }
  return context;
};
