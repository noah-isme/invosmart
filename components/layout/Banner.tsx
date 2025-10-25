"use client";

import { useState } from "react";

type BannerProps = {
  text: string;
};

export function Banner({ text }: BannerProps) {
  const [visible, setVisible] = useState(true);

  if (!visible) {
    return null;
  }

  return (
    <div
      role="banner"
      className="flex items-center justify-between gap-4 border-b border-primary/40 bg-primary/15 px-4 py-3 text-sm text-primary-foreground backdrop-blur"
    >
      <span className="font-medium tracking-wide text-primary-foreground/90">{text}</span>
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="rounded-full border border-primary/40 px-3 py-1 text-xs uppercase tracking-[0.28em] text-primary-foreground/80 transition hover:border-primary/70 hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        aria-label="Tutup pengumuman"
      >
        Tutup
      </button>
    </div>
  );
}
