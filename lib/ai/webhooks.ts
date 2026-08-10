import { AutoActionStatus, AutoActionType, type AiAutoAction } from "@prisma/client";

export type WebhookResultItem = {
  ok: boolean;
  error?: string;
};

export type WebhookDispatchResult = {
  discord?: WebhookResultItem;
  slack?: WebhookResultItem;
};

/**
 * Returns integer hex color code corresponding to AutoActionType.
 * AUTOPUBLISH: Emerald Green (0x2ecc71 / 3066993)
 * SCHEDULE_UPDATE: Peter River Blue (0x3498db / 3447003)
 * AUTO_REVERT: Alizarin Red (0xe74c3c / 15158332)
 * AUTO_CTA_TUNE: Amethyst Purple (0x9b59b6 / 10181046)
 * Default fallback: Peter River Blue (0x3498db)
 */
export function getEmbedColor(actionType?: string): number {
  switch (actionType) {
    case AutoActionType.AUTOPUBLISH:
    case "AUTOPUBLISH":
      return 0x2ecc71; // Green
    case AutoActionType.SCHEDULE_UPDATE:
    case "SCHEDULE_UPDATE":
      return 0x3498db; // Blue
    case AutoActionType.AUTO_REVERT:
    case "AUTO_REVERT":
      return 0xe74c3c; // Red
    case AutoActionType.AUTO_CTA_TUNE:
    case "AUTO_CTA_TUNE":
      return 0x9b59b6; // Purple
    default:
      return 0x3498db;
  }
}

/**
 * Formats Discord Embed payload for AI Auto Action.
 */
export function formatDiscordEmbed(action: Partial<AiAutoAction> | Record<string, any>) {
  const actionType = action.actionType ?? "UNKNOWN";
  const status = action.status ?? AutoActionStatus.applied;
  const color = getEmbedColor(String(actionType));
  const confidenceStr =
    action.confidence !== undefined && action.confidence !== null
      ? `${(action.confidence * 100).toFixed(1)}%`
      : "N/A";
  const timestamp = action.createdAt
    ? new Date(action.createdAt).toISOString()
    : new Date().toISOString();

  return {
    embeds: [
      {
        title: `AI Auto Action: ${actionType} [${status}]`,
        description: `Automated AI action (${actionType}) logged with status \`${status}\`.`,
        color,
        fields: [
          { name: "Action Type", value: String(actionType), inline: true },
          { name: "Organization ID", value: String(action.organizationId ?? "N/A"), inline: true },
          { name: "Status", value: String(status), inline: true },
          { name: "Reason", value: String(action.reason ?? "N/A"), inline: false },
          { name: "Confidence", value: confidenceStr, inline: true },
        ],
        timestamp,
      },
    ],
  };
}

/**
 * Formats Slack Block Kit payload for AI Auto Action.
 */
export function formatSlackBlocks(action: Partial<AiAutoAction> | Record<string, any>) {
  const actionType = action.actionType ?? "UNKNOWN";
  const status = action.status ?? AutoActionStatus.applied;
  const confidenceStr =
    action.confidence !== undefined && action.confidence !== null
      ? `${(action.confidence * 100).toFixed(1)}%`
      : "N/A";
  const timestamp = action.createdAt
    ? new Date(action.createdAt).toISOString()
    : new Date().toISOString();

  return {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `AI Auto Action Alert: ${actionType}`,
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Action Type:*\n${actionType}` },
          { type: "mrkdwn", text: `*Organization ID:*\n${action.organizationId ?? "N/A"}` },
          { type: "mrkdwn", text: `*Status:*\n${status}` },
          { type: "mrkdwn", text: `*Confidence:*\n${confidenceStr}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Reason:*\n${action.reason ?? "N/A"}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Timestamp: ${timestamp}`,
          },
        ],
      },
    ],
  };
}

/**
 * Asynchronously dispatches formatted Discord embed & Slack Block Kit payloads
 * to DISCORD_WEBHOOK_URL and SLACK_WEBHOOK_URL if configured.
 * Catches all HTTP and network errors, returning status result objects without throwing.
 */
export async function dispatchWebhookAlert(
  action: Partial<AiAutoAction> | Record<string, any>
): Promise<WebhookDispatchResult> {
  const discordUrl = process.env.DISCORD_WEBHOOK_URL;
  const slackUrl = process.env.SLACK_WEBHOOK_URL;

  const result: WebhookDispatchResult = {};

  if (!discordUrl && !slackUrl) {
    return result;
  }

  const tasks: Promise<void>[] = [];

  if (discordUrl) {
    tasks.push(
      (async () => {
        try {
          const payload = formatDiscordEmbed(action);
          const response = await fetch(discordUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            result.discord = {
              ok: false,
              error: `HTTP ${response.status} ${response.statusText}`,
            };
          } else {
            result.discord = { ok: true };
          }
        } catch (err: any) {
          result.discord = {
            ok: false,
            error: err?.message || String(err),
          };
        }
      })()
    );
  }

  if (slackUrl) {
    tasks.push(
      (async () => {
        try {
          const payload = formatSlackBlocks(action);
          const response = await fetch(slackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            result.slack = {
              ok: false,
              error: `HTTP ${response.status} ${response.statusText}`,
            };
          } else {
            result.slack = { ok: true };
          }
        } catch (err: any) {
          result.slack = {
            ok: false,
            error: err?.message || String(err),
          };
        }
      })()
    );
  }

  await Promise.allSettled(tasks);
  return result;
}

// Aliases for test compatibility
export const formatDiscordEmbedPayload = formatDiscordEmbed;
export const formatSlackBlockKitPayload = formatSlackBlocks;
