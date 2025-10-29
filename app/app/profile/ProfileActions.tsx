"use client";

import Link from "next/link";

import { SignOutButton } from "@/components/auth/SignOutButton";

type ProfileActionsProps = {
  returnTo?: string;
};

export default function ProfileActions({ returnTo = "/app" }: ProfileActionsProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <SignOutButton />
      <Link
        href={returnTo}
        className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-text/80 transition hover:border-white/20 hover:text-text"
      >
        Kembali ke dashboard
      </Link>
    </div>
  );
}

