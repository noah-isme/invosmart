import type { ReactNode } from "react";

interface TopbarProps {
  title?: string;
  actions?: ReactNode;
}

export default function Topbar({ title = "Dashboard", actions }: TopbarProps) {
  return (
    <header className="fixed top-0 inset-x-0 z-40 h-14 border-b border-white/10 bg-white/5 backdrop-blur-md">
      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-between px-4">
        <h1 className="text-base font-semibold text-gray-100">{title}</h1>
        {actions ? <div className="flex items-center gap-3 text-sm text-gray-300">{actions}</div> : null}
      </div>
    </header>
  );
}
