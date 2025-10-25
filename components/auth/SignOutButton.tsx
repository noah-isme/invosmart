"use client";

import { signOut } from "next-auth/react";
import { useTransition } from "react";
import type { ReactNode } from "react";

export type SignOutButtonProps = {
  children?: ReactNode;
  className?: string;
  callbackUrl?: string;
};

export function SignOutButton({
  children = "Keluar",
  className,
  callbackUrl = "/auth/login",
}: SignOutButtonProps) {
  const [pending, startTransition] = useTransition();

  const baseClassName =
    "gradient-button inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-text shadow-lg shadow-primary-glow transition duration-200 hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary/80 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-60";

  const mergedClassName = className ? `${baseClassName} ${className}` : baseClassName;

  return (
    <button
      type="button"
      className={mergedClassName}
      onClick={() => {
        startTransition(() => {
          void signOut({ callbackUrl });
        });
      }}
      disabled={pending}
      aria-busy={pending}
    >
      {children}
    </button>
  );
}
