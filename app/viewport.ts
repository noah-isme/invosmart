import type { Viewport } from "next";

import { THEME_COLORS } from "./theme-colors";

export function generateViewport(): Viewport {
  return {
    themeColor: [...THEME_COLORS],
    colorScheme: "light dark",
  };
}

