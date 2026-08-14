import { z } from "zod";

const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().min(1),
});

export type ApiCursor = z.infer<typeof cursorSchema>;

const encodeBase64Url = (value: string) =>
  Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
};

export const encodeCursor = (value: { createdAt: Date | string; id: string }) =>
  encodeBase64Url(
    JSON.stringify({
      createdAt: value.createdAt instanceof Date
        ? value.createdAt.toISOString()
        : value.createdAt,
      id: value.id,
    }),
  );

export const decodeCursor = (value: string): ApiCursor | null => {
  if (!value || value.length > 512) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(decodeBase64Url(value)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const parseLimit = (value: string | null, defaultLimit = 50, maxLimit = 100) => {
  if (value === null || value.trim() === "") return defaultLimit;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maxLimit) return null;
  return parsed;
};
