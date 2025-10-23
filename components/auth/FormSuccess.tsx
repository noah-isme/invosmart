import type { ReactNode } from "react";

export function FormSuccess({ message }: { message?: ReactNode }) {
  if (!message) {
    return null;
  }

  return (
    <div
      role="status"
      className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400"
    >
      {message}
    </div>
  );
}
