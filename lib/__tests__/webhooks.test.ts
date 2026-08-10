import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AiAutoActionMock = {
  count: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

const { aiAutoActionMock, prismaEnums } = vi.hoisted(() => ({
  aiAutoActionMock: {
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  } as AiAutoActionMock,
  prismaEnums: {
    AutoActionType: {
      AUTOPUBLISH: "AUTOPUBLISH",
      SCHEDULE_UPDATE: "SCHEDULE_UPDATE",
      AUTO_REVERT: "AUTO_REVERT",
      AUTO_CTA_TUNE: "AUTO_CTA_TUNE",
    },
    AutoActionStatus: {
      applied: "applied",
      reverted: "reverted",
      failed: "failed",
    },
    ExperimentAxis: {
      HOOK: "HOOK",
      CAPTION: "CAPTION",
      CTA: "CTA",
      SCHEDULE: "SCHEDULE",
    },
  },
}));

vi.mock("@prisma/client", () => prismaEnums);

vi.mock("@/lib/db", () => ({
  db: {
    aiAutoAction: aiAutoActionMock,
  },
}));

import {
  dispatchWebhookAlert,
  formatDiscordEmbed,
  formatSlackBlocks,
  getEmbedColor,
} from "@/lib/ai/webhooks";

const { AutoActionType, AutoActionStatus } = prismaEnums;

describe("lib/ai/webhooks.ts", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("getEmbedColor", () => {
    it("returns correct color codes for each AutoActionType", () => {
      expect(getEmbedColor(AutoActionType.AUTOPUBLISH)).toBe(0x2ecc71); // Emerald Green
      expect(getEmbedColor(AutoActionType.SCHEDULE_UPDATE)).toBe(0x3498db); // Peter River Blue
      expect(getEmbedColor(AutoActionType.AUTO_REVERT)).toBe(0xe74c3c); // Alizarin Red
      expect(getEmbedColor(AutoActionType.AUTO_CTA_TUNE)).toBe(0x9b59b6); // Amethyst Purple
      expect(getEmbedColor("AUTOPUBLISH")).toBe(0x2ecc71);
      expect(getEmbedColor("SCHEDULE_UPDATE")).toBe(0x3498db);
      expect(getEmbedColor("AUTO_REVERT")).toBe(0xe74c3c);
      expect(getEmbedColor("AUTO_CTA_TUNE")).toBe(0x9b59b6);
      expect(getEmbedColor("UNKNOWN")).toBe(0x3498db); // Default fallback
      expect(getEmbedColor(undefined)).toBe(0x3498db); // Default fallback
    });
  });

  describe("formatDiscordEmbed", () => {
    it("formats Discord Embed with correct fields, color, and timestamp", () => {
      const sampleAction = {
        actionType: AutoActionType.AUTOPUBLISH,
        organizationId: "org-123",
        status: AutoActionStatus.applied,
        reason: "High confidence score achieved",
        confidence: 0.92,
        createdAt: new Date("2026-08-10T12:00:00Z"),
      };

      const payload = formatDiscordEmbed(sampleAction);

      expect(payload).toHaveProperty("embeds");
      expect(payload.embeds).toHaveLength(1);
      const embed = payload.embeds[0];
      expect(embed.title).toContain("AUTOPUBLISH");
      expect(embed.color).toBe(0x2ecc71);
      expect(embed.timestamp).toBe("2026-08-10T12:00:00.000Z");

      const fieldsMap = Object.fromEntries(embed.fields.map((f: any) => [f.name, f.value]));
      expect(fieldsMap["Action Type"]).toBe("AUTOPUBLISH");
      expect(fieldsMap["Organization ID"]).toBe("org-123");
      expect(fieldsMap["Status"]).toBe("applied");
      expect(fieldsMap["Reason"]).toBe("High confidence score achieved");
      expect(fieldsMap["Confidence"]).toBe("92.0%");
    });

    it("handles missing confidence and default fields gracefully", () => {
      const sampleAction = {};
      const payload = formatDiscordEmbed(sampleAction);
      const embed = payload.embeds[0];
      const fieldsMap = Object.fromEntries(embed.fields.map((f: any) => [f.name, f.value]));

      expect(fieldsMap["Action Type"]).toBe("UNKNOWN");
      expect(fieldsMap["Organization ID"]).toBe("N/A");
      expect(fieldsMap["Status"]).toBe(AutoActionStatus.applied);
      expect(fieldsMap["Reason"]).toBe("N/A");
      expect(fieldsMap["Confidence"]).toBe("N/A");
    });
  });

  describe("formatSlackBlocks", () => {
    it("formats Slack Block Kit with header, section, and context blocks", () => {
      const sampleAction = {
        actionType: AutoActionType.AUTO_REVERT,
        organizationId: "org-456",
        status: AutoActionStatus.reverted,
        reason: "Performance regression detected",
        confidence: 0.85,
        createdAt: new Date("2026-08-10T14:30:00Z"),
      };

      const payload = formatSlackBlocks(sampleAction);

      expect(payload).toHaveProperty("blocks");
      expect(payload.blocks).toHaveLength(4);

      const [header, fieldsSection, reasonSection, context] = payload.blocks;
      expect(header.type).toBe("header");
      expect(header.text.text).toContain("AUTO_REVERT");

      expect(fieldsSection.type).toBe("section");
      expect(fieldsSection.fields).toHaveLength(4);

      expect(reasonSection.type).toBe("section");
      expect(reasonSection.text.text).toContain("Performance regression detected");

      expect(context.type).toBe("context");
      expect(context.elements[0].text).toContain("2026-08-10T14:30:00.000Z");
    });

    it("handles missing fields in Slack Block Kit payload", () => {
      const sampleAction = {};
      const payload = formatSlackBlocks(sampleAction);

      expect(payload.blocks).toHaveLength(4);
      const [header, fieldsSection, reasonSection] = payload.blocks;
      expect(header.text.text).toContain("UNKNOWN");
      const fieldTexts = fieldsSection.fields.map((f: any) => f.text);
      expect(fieldTexts[1]).toContain("N/A");
      expect(fieldTexts[3]).toContain("N/A");
      expect(reasonSection.text.text).toContain("N/A");
    });
  });

  describe("dispatchWebhookAlert", () => {
    it("skips dispatch gracefully when environment variables are unset", async () => {
      delete process.env.DISCORD_WEBHOOK_URL;
      delete process.env.SLACK_WEBHOOK_URL;

      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const result = await dispatchWebhookAlert({ actionType: AutoActionType.AUTOPUBLISH });

      expect(result).toEqual({});
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("dispatches HTTP POST requests to configured URLs on success", async () => {
      process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/123/abc";
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/456/def";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
      });
      vi.stubGlobal("fetch", mockFetch);

      const action = {
        actionType: AutoActionType.SCHEDULE_UPDATE,
        organizationId: "org-789",
        reason: "Schedule optimization",
        confidence: 0.88,
      };

      const result = await dispatchWebhookAlert(action);

      expect(result).toEqual({
        discord: { ok: true },
        slack: { ok: true },
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://discord.com/api/webhooks/123/abc",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "https://hooks.slack.com/services/456/def",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    it("catches non-ok status codes and network errors gracefully without throwing", async () => {
      process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/fail";
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/error";

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("discord")) {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
          });
        }
        return Promise.reject(new TypeError("Network connection failed"));
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await dispatchWebhookAlert({ actionType: AutoActionType.AUTO_CTA_TUNE });

      expect(result.discord).toEqual({
        ok: false,
        error: "HTTP 500 Internal Server Error",
      });
      expect(result.slack).toEqual({
        ok: false,
        error: "Network connection failed",
      });
    });
  });

  describe("Integration with approval-gates", () => {
    it("triggers dispatchWebhookAlert when logAutoAction is called", async () => {
      process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/test";
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetch);

      const createdRecord = {
        id: 10,
        organizationId: "org-1",
        actionType: AutoActionType.AUTOPUBLISH,
        contentId: 1,
        experimentId: 2,
        variantId: 3,
        reason: "Auto publish trigger",
        confidence: 0.95,
        status: AutoActionStatus.applied,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      aiAutoActionMock.create.mockResolvedValue(createdRecord);

      const { logAutoAction } = await import("@/lib/ai/approval-gates");
      const res = await logAutoAction({
        organizationId: "org-1",
        actionType: AutoActionType.AUTOPUBLISH as any,
        reason: "Auto publish trigger",
        confidence: 0.95,
      });

      expect(res).toEqual(createdRecord);
      expect(aiAutoActionMock.create).toHaveBeenCalled();
      // Allow async dispatch to settle
      await new Promise((r) => setTimeout(r, 50));
      expect(mockFetch).toHaveBeenCalledWith(
        "https://discord.com/api/webhooks/test",
        expect.anything()
      );
    });

    it("triggers dispatchWebhookAlert when markAutoActionReverted is called", async () => {
      process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/test";
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetch);

      const updatedRecord = {
        id: 10,
        organizationId: "org-1",
        actionType: AutoActionType.AUTOPUBLISH,
        reason: "Manual revert triggered",
        confidence: 0.95,
        status: AutoActionStatus.reverted,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      aiAutoActionMock.update.mockResolvedValue(updatedRecord);

      const { markAutoActionReverted } = await import("@/lib/ai/approval-gates");
      const res = await markAutoActionReverted({ actionId: 10, reason: "Manual revert triggered" });

      expect(res).toEqual(updatedRecord);
      expect(aiAutoActionMock.update).toHaveBeenCalled();
      // Allow async dispatch to settle
      await new Promise((r) => setTimeout(r, 50));
      expect(mockFetch).toHaveBeenCalledWith(
        "https://hooks.slack.com/services/test",
        expect.anything()
      );
    });
  });
});
