import { describe, expect, it } from "vitest";

import {
  buildReminderOccurrenceIdentity,
  createReminderOccurrenceKey,
  getReminderOccurrenceAt,
} from "@/lib/team/reminders";

describe("team reminder occurrence helpers", () => {
  const baseInput = {
    workspaceId: "workspace-1",
    invoiceId: "invoice-1",
    ruleId: "rule-1",
    dueAt: "2026-08-20T09:30:00.000Z",
    offsetDays: -3,
  } as const;

  it("calculates a deterministic UTC due-date offset and canonical identity", () => {
    expect(getReminderOccurrenceAt(baseInput.dueAt, baseInput.offsetDays).toISOString()).toBe(
      "2026-08-17T09:30:00.000Z",
    );
    expect(buildReminderOccurrenceIdentity(baseInput)).toEqual({
      scopeId: "workspace-1",
      invoiceId: "invoice-1",
      ruleId: "rule-1",
      dueAt: "2026-08-20T09:30:00.000Z",
      offsetDays: -3,
      occurrenceAt: "2026-08-17T09:30:00.000Z",
    });
  });

  it("returns the same idempotency key for equivalent dates and different keys for identity changes", () => {
    const key = createReminderOccurrenceKey(baseInput);
    expect(key).toMatch(/^reminder:v1:[0-9a-f]{64}$/);
    expect(
      createReminderOccurrenceKey({ ...baseInput, dueAt: new Date(baseInput.dueAt) }),
    ).toBe(key);
    expect(createReminderOccurrenceKey({ ...baseInput, offsetDays: 0 })).not.toBe(key);
    expect(createReminderOccurrenceKey({ ...baseInput, ruleId: "rule-2" })).not.toBe(key);
    expect(createReminderOccurrenceKey({ ...baseInput, workspaceId: "workspace-2" })).not.toBe(key);
  });

  it("supports organization scope and rejects ambiguous date/offset inputs", () => {
    expect(
      buildReminderOccurrenceIdentity({
        organizationId: "org-1",
        invoiceId: 12,
        ruleId: 7,
        dueAt: "2026-08-20",
        offsetDays: -0,
      }),
    ).toMatchObject({ scopeId: "org-1", invoiceId: "12", ruleId: "7", offsetDays: 0 });
    expect(() => getReminderOccurrenceAt("not-a-date", 1)).toThrow(TypeError);
    expect(() => getReminderOccurrenceAt(baseInput.dueAt, 1.5)).toThrow(TypeError);
    expect(() => createReminderOccurrenceKey({ ...baseInput, invoiceId: "" })).toThrow(TypeError);
  });
});
