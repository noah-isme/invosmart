import type { PropsWithChildren, ReactNode } from "react";

export type AuthCardProps = PropsWithChildren<{
  title: string;
  subtitle?: ReactNode;
}>;

export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-4 py-16">
      <div className="w-full space-y-8 rounded-xl border border-border bg-background/80 p-8 shadow-lg backdrop-blur">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </header>
        {children}
      </div>
    </div>
  );
}
