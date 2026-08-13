import { NextRequest, NextResponse } from "next/server";

import { requireCronAuthorization } from "@/lib/cron-auth";
import { dispatchReminderDeliveries } from "@/lib/team/reminder-delivery";

export const dynamic = "force-dynamic";

/** Dispatches due invoice reminder deliveries with provider-neutral retries. */
export async function GET(request: NextRequest) {
  const authError = requireCronAuthorization(request);
  if (authError) return authError;

  try {
    const rawLimit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 50;
    const summary = await dispatchReminderDeliveries({ limit });
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Cron Reminder Delivery GET] Error:", message.slice(0, 240));
    return NextResponse.json(
      { success: false, error: "Reminder delivery dispatch failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
