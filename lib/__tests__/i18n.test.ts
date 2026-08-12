import { describe, expect, it } from "vitest";
import enJson from "../i18n/locales/en.json";
import idJson from "../i18n/locales/id.json";
import {
  getTranslation,
  getNestedValue,
  interpolateParams,
  isValidLocale,
  DEFAULT_LOCALE,
  dictionaries,
} from "../i18n";

describe("i18n Framework (lib/i18n/)", () => {
  describe("Dictionary Integrity", () => {
    it("exports valid dictionaries for en and id", () => {
      expect(dictionaries.en).toBeDefined();
      expect(dictionaries.id).toBeDefined();
      expect(typeof dictionaries.en).toBe("object");
      expect(typeof dictionaries.id).toBe("object");
    });

    it("en.json and id.json contain standard namespaces", () => {
      expect(enJson).toHaveProperty("common");
      expect(enJson).toHaveProperty("nav");
      expect(enJson).toHaveProperty("settings");
      expect(enJson).toHaveProperty("invoices");

      expect(idJson).toHaveProperty("common");
      expect(idJson).toHaveProperty("nav");
      expect(idJson).toHaveProperty("settings");
      expect(idJson).toHaveProperty("invoices");
    });
  });

  describe("isValidLocale", () => {
    it("returns true for supported locales ('en', 'id')", () => {
      expect(isValidLocale("en")).toBe(true);
      expect(isValidLocale("id")).toBe(true);
    });

    it("returns false for unsupported locales or invalid inputs", () => {
      expect(isValidLocale("fr")).toBe(false);
      expect(isValidLocale("es")).toBe(false);
      expect(isValidLocale("")).toBe(false);
      expect(isValidLocale(null)).toBe(false);
      expect(isValidLocale(123)).toBe(false);
    });
  });

  describe("getNestedValue", () => {
    it("retrieves nested string by dot notation", () => {
      const obj = { a: { b: { c: "hello" } } };
      expect(getNestedValue(obj, "a.b.c")).toBe("hello");
    });

    it("returns undefined for non-existent path", () => {
      const obj = { a: { b: "hello" } };
      expect(getNestedValue(obj, "a.b.c")).toBeUndefined();
      expect(getNestedValue(obj, "x.y")).toBeUndefined();
    });

    it("returns undefined for non-object inputs", () => {
      expect(getNestedValue(null, "a.b")).toBeUndefined();
      expect(getNestedValue("string", "a")).toBeUndefined();
    });
  });

  describe("interpolateParams", () => {
    it("replaces {{param}} placeholders", () => {
      const result = interpolateParams("Hello {{name}}, welcome to {{app}}!", {
        name: "Alice",
        app: "InvoSmart",
      });
      expect(result).toBe("Hello Alice, welcome to InvoSmart!");
    });

    it("replaces {param} placeholders", () => {
      const result = interpolateParams("Item count: {count}", { count: 10 });
      expect(result).toBe("Item count: 10");
    });

    it("returns original template when no params provided", () => {
      expect(interpolateParams("No params here")).toBe("No params here");
    });
  });

  describe("getTranslation", () => {
    it("translates English keys correctly", () => {
      expect(getTranslation("en", "common.save")).toBe("Save");
      expect(getTranslation("en", "common.cancel")).toBe("Cancel");
      expect(getTranslation("en", "settings.language.title")).toBe("Language Settings");
      expect(getTranslation("en", "invoices.status.paid")).toBe("Paid");
      expect(getTranslation("en", "invoices.status.unpaid")).toBe("Unpaid");
      expect(getTranslation("en", "invoices.status.draft")).toBe("Draft");
      expect(getTranslation("en", "invoices.status.sent")).toBe("Sent");
      expect(getTranslation("en", "invoices.status.overdue")).toBe("Overdue");
      expect(getTranslation("en", "nav.dashboard")).toBe("Dashboard");
      expect(getTranslation("en", "nav.clients")).toBe("Clients");
    });

    it("translates Indonesian keys correctly", () => {
      expect(getTranslation("id", "common.save")).toBe("Simpan");
      expect(getTranslation("id", "common.cancel")).toBe("Batal");
      expect(getTranslation("id", "settings.language.title")).toBe("Pengaturan Bahasa");
      expect(getTranslation("id", "invoices.status.paid")).toBe("Lunas");
      expect(getTranslation("id", "invoices.status.unpaid")).toBe("Belum Lunas");
      expect(getTranslation("id", "invoices.status.draft")).toBe("Draf");
      expect(getTranslation("id", "invoices.status.sent")).toBe("Terkirim");
      expect(getTranslation("id", "invoices.status.overdue")).toBe("Jatuh Tempo");
      expect(getTranslation("id", "nav.dashboard")).toBe("Dashboard");
      expect(getTranslation("id", "nav.clients")).toBe("Pelanggan");
    });

    it("supports parameter interpolation in translations", () => {
      expect(getTranslation("en", "common.welcome", { name: "Bob" })).toBe("Welcome, Bob");
      expect(getTranslation("id", "common.welcome", { name: "Budi" })).toBe("Selamat datang, Budi");
    });

    it("falls back to English when key is missing in Indonesian", () => {
      // Mocking a missing key scenario
      const customDicts = dictionaries as Record<string, Record<string, unknown>>;
      customDicts.en.testKeyOnlyEn = "English Only Text";

      expect(getTranslation("id", "testKeyOnlyEn")).toBe("English Only Text");

      delete customDicts.en.testKeyOnlyEn;
    });

    it("returns raw key when missing in both locales", () => {
      expect(getTranslation("en", "non.existent.key.xyz")).toBe("non.existent.key.xyz");
      expect(getTranslation("id", "non.existent.key.xyz")).toBe("non.existent.key.xyz");
    });

    it("uses default locale 'en' when invalid locale passed", () => {
      expect(getTranslation("fr" as any, "common.save")).toBe("Save");
    });
  });
});
