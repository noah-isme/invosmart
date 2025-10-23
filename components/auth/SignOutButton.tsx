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
    "inline-flex items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:opacity-80";

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
