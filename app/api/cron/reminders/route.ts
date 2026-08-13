import { NextRequest, NextResponse } from "next/server";

import { requireCronAuthorization } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { createReminderOccurrenceKey, getReminderOccurrenceAt } from "@/lib/team/reminders";

/**
 * Materializes due reminder occurrences. Delivery workers can safely retry
 * these rows because occurrenceKey is unique and status is explicit.
 */
export async function GET(request: NextRequest) {
  const authError = requireCronAuthorization(request);
  if (authError) return authError;

  const now = new Date();
  const rules = await db.invoiceReminderRule.findMany({
    where: { enabled: true },
    select: { id: true, organizationId: true, offsetDays: true },
  });
  let created = 0;
  for (const rule of rules) {
    const invoices = await db.invoice.findMany({
      where: {
        organizationId: rule.organizationId,
        dueAt: { not: null },
        status: { in: ["SENT", "UNPAID", "OVERDUE"] },
      },
      select: { id: true, dueAt: true },
    });
    for (const invoice of invoices) {
      if (!invoice.dueAt) continue;
      const scheduledAt = getReminderOccurrenceAt(invoice.dueAt, rule.offsetDays);
      if (scheduledAt > now || scheduledAt < new Date(now.getTime() - 24 * 60 * 60 * 1000)) continue;
      const occurrenceKey = createReminderOccurrenceKey({
        organizationId: rule.organizationId,
        invoiceId: invoice.id,
        ruleId: rule.id,
        dueAt: invoice.dueAt,
        offsetDays: rule.offsetDays,
      });
      try {
        await db.invoiceReminderOccurrence.create({
          data: {
            organizationId: rule.organizationId,
            invoiceId: invoice.id,
            ruleId: rule.id,
            occurrenceKey,
            scheduledAt,
          },
        });
        created += 1;
      } catch (error) {
        // Unique occurrenceKey means an already-materialized reminder is a
        // successful idempotent retry, not an operational failure.
        if (!(error instanceof Error && /unique|duplicate|P2002/i.test(error.message))) {
          console.error("[Cron Reminders] Failed to materialize occurrence:", error);
        }
      }
    }
  }

  return NextResponse.json({ success: true, timestamp: now.toISOString(), rules: rules.length, created });
}
