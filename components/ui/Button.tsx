"use client";

import { type MouseEventHandler, useEffect, useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";

type ButtonState = "idle" | "loading" | "success";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  successLabel?: string;
};

const cn = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

export function Button({
  children,
  className,
  variant = "primary",
  successLabel = "Tersimpan",
  disabled,
  onClick,
  ...rest
}: ButtonProps) {
  const [state, setState] = useState<ButtonState>("idle");
  const [successTimer, setSuccessTimer] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (successTimer) {
        window.clearTimeout(successTimer);
      }
    };
  }, [successTimer]);

  const isDisabled = useMemo(() => disabled || state === "loading", [disabled, state]);

  const handleClick: MouseEventHandler<HTMLButtonElement> | undefined = onClick
    ? async (event) => {
        if (state === "loading") {
          event.preventDefault();
          return;
        }

        try {
          setState("loading");
          // Persist synthetic events for async handlers
          if ("persist" in event && typeof event.persist === "function") {
            event.persist();
          }
          await onClick(event);
          setState("success");
          const timer = window.setTimeout(() => {
            setState("idle");
          }, 500);
          if (successTimer) {
            window.clearTimeout(successTimer);
          }
          setSuccessTimer(timer);
        } catch (error) {
          setState("idle");
          throw error;
        }
      }
    : undefined;

  const baseClasses =
    "relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

  const variantClasses =
    variant === "primary"
      ? "bg-primary/90 text-text hover:bg-primary"
      : "bg-white/10 text-text hover:bg-white/20";

  return (
    <button
      {...rest}
      type={rest.type ?? "button"}
      disabled={isDisabled}
      onClick={handleClick}
      data-state={state}
      className={cn(
        baseClasses,
        "hover:-translate-y-px hover:shadow-[0_0_12px_rgba(var(--color-primary)_/_0.45)]",
        state === "loading" ? "cursor-progress" : "",
        state === "success" ? "shadow-[0_0_18px_rgba(var(--color-primary)_/_0.45)]" : "",
        variantClasses,
        className,
      )}
    >
      <span className="absolute inset-0 -z-10 rounded-xl bg-[radial-gradient(circle_at_top,_rgba(var(--color-primary)_/_0.4),_transparent_60%),radial-gradient(circle_at_bottom,_rgba(var(--color-accent)_/_0.35),_transparent_55%)] opacity-0 blur-lg transition-opacity duration-300 ease-out hover:opacity-40" />
      {state === "loading" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {state === "success" ? <Check className="size-4" aria-hidden /> : null}
      <span className="transition-transform duration-200" aria-live="polite">
        {state === "success" ? successLabel : children}
      </span>
    </button>
  );
}
