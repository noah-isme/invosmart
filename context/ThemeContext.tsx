"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type ThemeMode = "light" | "dark";

type ThemeShape = {
  primary: string;
  accent: string;
  mode: ThemeMode;
};

export interface ThemeContextValue extends ThemeShape {
  updateTheme: (next: Partial<ThemeShape>, options?: { persist?: boolean }) => Promise<void> | void;
  saveTheme: () => Promise<void>;
  resetTheme: () => Promise<void>;
  applyAiTheme: (
    suggestion: { primary: string; accent: string; mode?: ThemeMode | null | undefined },
    options?: { persist?: boolean },
  ) => Promise<void>;
  isLoading: boolean;
  isSaving: boolean;
}

const STORAGE_KEY = "invosmart.theme";

export const DEFAULT_THEME: ThemeShape = {
  primary: "#6366f1",
  accent: "#22d3ee",
  mode: "dark",
};

const MODE_TOKEN = {
  dark: {
    bg: "14 16 22",
    text: "243 244 246",
  },
  light: {
    bg: "255 255 255",
    text: "15 23 42",
  },
} satisfies Record<ThemeMode, { bg: string; text: string }>;

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const isHexColor = (value: string) => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);

const expandHex = (value: string) => {
  if (value.length === 4) {
    return `#${value
      .slice(1)
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`;
  }

  return value;
};

const normalizeHex = (value: string | undefined, fallback: string) => {
  if (!value) {
    return fallback;
  }

  let normalized = value.trim();
  if (!normalized.startsWith("#")) {
    normalized = `#${normalized}`;
  }

  if (!isHexColor(normalized)) {
    return fallback;
  }

  return expandHex(normalized.toLowerCase());
};

const normalizeMode = (mode: string | undefined): ThemeMode => (mode === "light" ? "light" : "dark");

const hexToRgb = (hex: string): [number, number, number] => {
  const expanded = expandHex(hex.toLowerCase());
  const value = expanded.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return [r, g, b];
};

const applyThemeToDocument = (theme: ThemeShape) => {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const [pr, pg, pb] = hexToRgb(theme.primary);
  const [ar, ag, ab] = hexToRgb(theme.accent);

  root.style.setProperty("--color-primary", `${pr} ${pg} ${pb}`);
  root.style.setProperty("--color-accent", `${ar} ${ag} ${ab}`);

  const modeTokens = MODE_TOKEN[theme.mode];
  root.style.setProperty("--color-bg", modeTokens.bg);
  root.style.setProperty("--color-text", modeTokens.text);
  root.style.setProperty("color-scheme", theme.mode);
  root.dataset.theme = theme.mode;
};

const loadStoredTheme = (): ThemeShape | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as Partial<ThemeShape> | null;
    if (!parsed) {
      return null;
    }

    return {
      primary: normalizeHex(parsed.primary, DEFAULT_THEME.primary),
      accent: normalizeHex(parsed.accent, DEFAULT_THEME.accent),
      mode: normalizeMode(parsed.mode),
    } satisfies ThemeShape;
  } catch {
    return null;
  }
};

const persistTheme = (theme: ThemeShape) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
};

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setTheme] = useState<ThemeShape>(DEFAULT_THEME);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const stateRef = useRef<ThemeShape>(DEFAULT_THEME);
  const isMountedRef = useRef(false);

  const setAndApplyTheme = useCallback((next: ThemeShape) => {
    const normalized: ThemeShape = {
      primary: normalizeHex(next.primary, DEFAULT_THEME.primary),
      accent: normalizeHex(next.accent, DEFAULT_THEME.accent),
      mode: normalizeMode(next.mode),
    };

    stateRef.current = normalized;
    setTheme(normalized);
    applyThemeToDocument(normalized);
    persistTheme(normalized);
  }, []);

  useEffect(() => {
    const stored = loadStoredTheme();
    if (stored) {
      setAndApplyTheme(stored);
    } else {
      setAndApplyTheme(DEFAULT_THEME);
    }
    setIsLoading(false);
    isMountedRef.current = true;
  }, [setAndApplyTheme]);

  useEffect(() => {
    if (!isMountedRef.current) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const fetchTheme = async () => {
      try {
        const response = await fetch("/api/user/theme", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          cache: "no-store",
          credentials: "same-origin",
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            return;
          }
          return;
        }

        const payload = (await response.json()) as {
          data?: { primary?: string | null; accent?: string | null; mode?: ThemeMode };
        };

        if (cancelled || !payload?.data) {
          return;
        }

        setAndApplyTheme({
          primary: normalizeHex(payload.data.primary ?? undefined, DEFAULT_THEME.primary),
          accent: normalizeHex(payload.data.accent ?? undefined, DEFAULT_THEME.accent),
          mode: normalizeMode(payload.data.mode),
        });
      } catch {
        /* noop */
      }
    };

    fetchTheme();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [setAndApplyTheme]);

  const handlePersist = useCallback(
    async (current: ThemeShape) => {
      if (typeof window === "undefined") {
        return;
      }

      setIsSaving(true);
      try {
        const response = await fetch("/api/user/theme", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            themePrimary: current.primary.toLowerCase(),
            themeAccent: current.accent.toLowerCase(),
            themeMode: current.mode,
          }),
        });

        if (!response.ok) {
          // Silently ignore unauthenticated responses to keep client-side theme working offline.
          if (response.status === 401 || response.status === 403) {
            return;
          }
        }
      } catch {
        // Ignore network errors to avoid breaking the UI while offline.
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  const updateTheme = useCallback<ThemeContextValue["updateTheme"]>(
    async (next, options) => {
      const merged: ThemeShape = {
        primary: normalizeHex(next.primary ?? stateRef.current.primary, stateRef.current.primary),
        accent: normalizeHex(next.accent ?? stateRef.current.accent, stateRef.current.accent),
        mode: normalizeMode(next.mode ?? stateRef.current.mode),
      };

      setAndApplyTheme(merged);

      if (options?.persist) {
        await handlePersist(merged);
      }
    },
    [handlePersist, setAndApplyTheme],
  );

  const saveTheme = useCallback(async () => {
    await handlePersist(stateRef.current);
  }, [handlePersist]);

  const resetTheme = useCallback(async () => {
    const normalizedDefault = {
      primary: DEFAULT_THEME.primary,
      accent: DEFAULT_THEME.accent,
      mode: DEFAULT_THEME.mode,
    } as const;

    setAndApplyTheme(normalizedDefault);
    await handlePersist(normalizedDefault);
  }, [handlePersist, setAndApplyTheme]);

  const applyAiTheme = useCallback<ThemeContextValue["applyAiTheme"]>(
    async (suggestion, options) => {
      const merged: ThemeShape = {
        primary: normalizeHex(suggestion.primary, stateRef.current.primary),
        accent: normalizeHex(suggestion.accent, stateRef.current.accent),
        mode: suggestion.mode ? normalizeMode(suggestion.mode) : stateRef.current.mode,
      };

      setAndApplyTheme(merged);

      if (options?.persist) {
        await handlePersist(merged);
      }
    },
    [handlePersist, setAndApplyTheme],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      ...theme,
      updateTheme,
      saveTheme,
      resetTheme,
      applyAiTheme,
      isLoading,
      isSaving,
    }),
    [applyAiTheme, isLoading, isSaving, resetTheme, saveTheme, theme, updateTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
