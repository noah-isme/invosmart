"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import enDictionary from "./locales/en.json";
import idDictionary from "./locales/id.json";

export type Locale = "en" | "id";

export const DEFAULT_LOCALE: Locale = "en";
export const STORAGE_KEY = "invosmart.locale";

export const dictionaries: Record<Locale, Record<string, unknown>> = {
  en: enDictionary,
  id: idDictionary,
};

export const isValidLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (value === "en" || value === "id");

/**
 * Traverses a nested object by dot-separated path (e.g. "settings.language.title")
 */
export function getNestedValue(obj: unknown, path: string): string | undefined {
  if (!obj || typeof obj !== "object") {
    return undefined;
  }

  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current && typeof current === "object" && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return typeof current === "string" ? current : undefined;
}

/**
 * Interpolates parameter placeholders in string like {{name}} or {name}
 */
export function interpolateParams(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params || Object.keys(params).length === 0) {
    return template;
  }

  let result = template;
  for (const [key, value] of Object.entries(params)) {
    const valStr = String(value);
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), valStr);
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), valStr);
  }
  return result;
}

/**
 * Core translation resolver function with fallback
 */
export function getTranslation(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const dict = dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
  let val = getNestedValue(dict, key);

  if (val === undefined && locale !== DEFAULT_LOCALE) {
    val = getNestedValue(dictionaries[DEFAULT_LOCALE], key);
  }

  if (val === undefined) {
    return key;
  }

  return interpolateParams(val, params);
}

export interface I18nContextValue {
  locale: Locale;
  setLocale: (newLocale: Locale) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
  isLoading: boolean;
}

export const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (initialLocale && isValidLocale(initialLocale)) {
      return initialLocale;
    }
    return DEFAULT_LOCALE;
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    // Check localStorage first
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isValidLocale(stored)) {
        setLocaleState(stored);
      }
    }

    // Optionally fetch from API for logged-in user
    let active = true;
    const fetchUserLocale = async () => {
      try {
        const res = await fetch("/api/user/locale", { method: "GET" });
        if (res.ok) {
          const body = await res.json();
          const fetchedLocale = body?.data?.locale ?? body?.locale;
          if (active && isValidLocale(fetchedLocale)) {
            setLocaleState(fetchedLocale);
            if (typeof window !== "undefined") {
              window.localStorage.setItem(STORAGE_KEY, fetchedLocale);
            }
          }
        }
      } catch {
        // Silently ignore network errors for offline support
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    fetchUserLocale();

    return () => {
      active = false;
    };
  }, []);

  const setLocale = useCallback(async (newLocale: Locale) => {
    if (!isValidLocale(newLocale)) {
      return;
    }

    setLocaleState(newLocale);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, newLocale);
      document.documentElement.lang = newLocale;
    }

    try {
      await fetch("/api/user/locale", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: newLocale }),
      });
    } catch {
      // Ignore network errors to avoid blocking UI
    }
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      return getTranslation(locale, key, params);
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
      isLoading,
    }),
    [locale, setLocale, t, isLoading],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const fallbackContext: I18nContextValue = {
  locale: DEFAULT_LOCALE,
  setLocale: async () => {},
  t: (key: string, params?: Record<string, string | number>) =>
    getTranslation(DEFAULT_LOCALE, key, params),
  isLoading: false,
};

export function useTranslation(): I18nContextValue {
  const context = useContext(I18nContext);
  return context ?? fallbackContext;
}
