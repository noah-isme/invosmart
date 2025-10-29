import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { __internal } from "@/lib/rum";

const { normaliseMetricValue, parseSampleRate, getSampleRate } = __internal;

describe("rum helpers", () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, "__INVOSMART_RUM_RATE__");
    window.localStorage.clear();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "__INVOSMART_RUM_RATE__");
    window.localStorage.clear();
  });

  it("normalises CLS with precision", () => {
    expect(normaliseMetricValue({ name: "CLS", value: 0.123456 })).toBeCloseTo(0.1235, 4);
  });

  it("rounds INP to 2 decimal places", () => {
    expect(normaliseMetricValue({ name: "INP", value: 187.556 })).toBeCloseTo(187.56, 2);
  });

  it("rounds other metrics to nearest millisecond", () => {
    expect(normaliseMetricValue({ name: "LCP", value: 2145.76 })).toBe(2146);
  });

  it("clamps sample rate parsing", () => {
    expect(parseSampleRate("1.5")).toBe(1);
    expect(parseSampleRate("-1")).toBe(0);
    expect(parseSampleRate("0.45")).toBeCloseTo(0.45, 2);
  });

  it("uses overrides from global scope when present", () => {
    (globalThis as { __INVOSMART_RUM_RATE__?: number }).__INVOSMART_RUM_RATE__ = 0.4;
    expect(getSampleRate()).toBeCloseTo(0.4, 2);
  });

  it("falls back to localStorage override", () => {
    window.localStorage.setItem("invosmart:rum-sample-rate", "0.65");
    expect(getSampleRate()).toBeCloseTo(0.65, 2);
  });
});

