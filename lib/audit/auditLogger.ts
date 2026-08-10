import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";

export enum AuditAction {
  INVOICE_CREATE = "INVOICE_CREATE",
  INVOICE_UPDATE = "INVOICE_UPDATE",
  INVOICE_DELETE = "INVOICE_DELETE",
  INVOICE_AUTO_OVERDUE = "INVOICE_AUTO_OVERDUE",
  AUTH_REGISTER = "AUTH_REGISTER",
  AUTH_LOGIN_SUCCESS = "AUTH_LOGIN_SUCCESS",
  AUTH_LOGIN_FAILURE = "AUTH_LOGIN_FAILURE",
  AUTH_LOGOUT = "AUTH_LOGOUT",
  AI_AUTO_ACTION = "AI_AUTO_ACTION",
  AI_AUTO_REVERT = "AI_AUTO_REVERT",
  AI_RECOVERY_ROLLBACK = "AI_RECOVERY_ROLLBACK",
}

export enum AuditEntity {
  INVOICE = "Invoice",
  USER = "User",
  AUTH = "Auth",
  AI_AUTO_ACTION = "AiAutoAction",
  RECOVERY = "Recovery",
}

export interface LogAuditEventInput {
  tenantId?: string | null;
  userId?: string | null;
  action: AuditAction | string;
  entity: AuditEntity | string;
  entityId?: string | null;
  details?: Record<string, unknown> | Prisma.InputJsonValue | null;
  ipAddress?: string | null;
}

/**
 * Extracts client IP address from Next.js request headers or request object.
 * Evaluates x-forwarded-for, x-real-ip, and req.ip fallback.
 */
export function getClientIp(req: Request | NextRequest | null | undefined): string | null {
  if (!req) return null;
  try {
    // Check req.ip first for plain request-like objects without full headers API
    if ("ip" in req) {
      const reqWithIp = req as unknown as { ip?: string; headers?: unknown };
      // If no headers API, use ip directly
      if (!reqWithIp.headers) {
        return typeof reqWithIp.ip === "string" ? reqWithIp.ip || null : null;
      }
    }

    const headers = (req as Request).headers;
    if (!headers || typeof headers.get !== "function") {
      // Fallback for plain objects
      if ("ip" in req) {
        const ip = (req as { ip?: string }).ip;
        return typeof ip === "string" ? ip || null : null;
      }
      return null;
    }

    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const clientIp = forwarded.split(",")[0].trim();
      if (clientIp) return clientIp;
    }

    const realIp = headers.get("x-real-ip");
    if (realIp && realIp.trim()) {
      return realIp.trim();
    }

    if ("ip" in req) {
      const reqWithIp = req as unknown as { ip?: string };
      if (typeof reqWithIp.ip === "string") {
        return reqWithIp.ip || null;
      }
    }
  } catch {
    // Non-blocking fallback for IP parsing exceptions
  }
  return null;
}

/**
 * Persists an audit log record into database.
 * Wrapped in try-catch to guarantee non-blocking behavior.
 */
export async function logAuditEvent(input: LogAuditEventInput) {
  try {
    return await db.auditLog.create({
      data: {
        tenantId: input.tenantId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ? String(input.entityId) : null,
        details: input.details !== undefined && input.details !== null
          ? (input.details as Prisma.InputJsonValue)
          : undefined,
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch (error) {
    console.error("[AuditLogger] Failed to persist audit log entry:", error);
    return null;
  }
}
