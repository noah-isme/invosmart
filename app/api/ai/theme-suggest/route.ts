import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { createClient, DEFAULT_MODEL } from "@/lib/ai";
import { z } from "zod";

import {
  buildCacheKey,
  getCachedThemeSuggestion,
  setCachedThemeSuggestion,
  type ThemeSuggestionPayload,
} from "@/lib/cache/theme-suggestions";
import { ThemeSuggestionSchema } from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { authOptions } from "@/server/auth";

const requestSchema = z.object({
  brandName: z
    .string({ required_error: "Nama brand wajib diisi" })
    .trim()
    .min(2, "Nama brand minimal 2 karakter")
    .max(120, "Nama brand maksimal 120 karakter"),
  logoUrl: z
    .string()
    .trim()
    .url("Logo URL harus berupa tautan valid")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
  preferredMode: z.enum(["light", "dark"]).default("dark"),
});

const promptTemplate = (
  brandName: string,
  preferredMode: "light" | "dark",
  logoUrl?: string,
) => {
  const base = `Buatkan palet warna primer & aksen yang cocok untuk merek ${brandName} dengan gaya ${preferredMode}.
Output dalam format JSON: { "primary": hex, "accent": hex, "label": string, "description": string }`;

  if (!logoUrl) {
    return base;
  }

  return `${base}\nLogo referensi: ${logoUrl}`;
};

const cleanResponse = (raw: string) => raw.replace(/```json|```/g, "").trim();

const extractJson = (content: string) => {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start === -1 || end === -1 || start > end) {
    throw new Error("JSON payload tidak ditemukan pada respons AI");
  }

  return content.slice(start, end + 1);
};

// Use createClient from lib/ai which prefers Gemini when configured.

const normalizeSuggestion = (payload: ThemeSuggestionPayload) => {
  const suggestion = ThemeSuggestionSchema.parse(payload);
  return {
    ...suggestion,
    primary: suggestion.primary.toLowerCase(),
    accent: suggestion.accent.toLowerCase(),
  } satisfies ThemeSuggestionPayload;
};

export async function POST(request: NextRequest) {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const limited = rateLimit(request, "ai-theme");
  if (limited) {
    return limited;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Data permintaan tidak valid", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { brandName, preferredMode, logoUrl } = parsed.data;
  const cacheKey = buildCacheKey(brandName, preferredMode, logoUrl);

  const cached = await getCachedThemeSuggestion(cacheKey);
  if (cached) {
    return NextResponse.json({ data: cached, cached: true });
  }

  try {
    const client = createClient();
    const prompt = promptTemplate(brandName, preferredMode, logoUrl);
    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.4,
    });

    const rawContent = completion.choices[0]?.message?.content ?? "{}";
    const cleaned = cleanResponse(rawContent);
    const jsonPayload = JSON.parse(extractJson(cleaned)) as ThemeSuggestionPayload;
    const normalized = normalizeSuggestion(jsonPayload);

    await setCachedThemeSuggestion(cacheKey, normalized);

    return NextResponse.json({ data: normalized, cached: false });
  } catch (error) {
    return NextResponse.json(
      { error: "Tidak dapat menghasilkan saran tema", message: error instanceof Error ? error.message : undefined },
      { status: 500 },
    );
  }
}
