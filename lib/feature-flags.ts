import { db } from "@/lib/db";
import type { FeatureFlag, Prisma } from "@prisma/client";

export type FlagContext = {
  tenantId?: string;
  userId?: string;
  [key: string]: unknown;
};

export type FeatureFlagInput = {
  id?: string;
  key: string;
  name: string;
  description?: string | null;
  enabled?: boolean;
  targetTenants?: unknown;
  targetUsers?: unknown;
};

const DEFAULT_FLAGS: Record<string, boolean> = {
  bayesian_ab_overlay: true,
};

/**
 * Runtime feature flag evaluation helper.
 * Returns true if flag is enabled globally or matched by targetTenants / targetUsers in context.
 * Returns default/false on error or missing flag.
 */
export async function getFlag(flagName: string, context?: FlagContext): Promise<boolean> {
  try {
    const flag = await db.featureFlag.findUnique({
      where: { key: flagName },
    });

    if (!flag) {
      return DEFAULT_FLAGS[flagName] ?? false;
    }

    if (flag.enabled) {
      return true;
    }

    // Check targetTenants scope if provided in context
    if (context?.tenantId && flag.targetTenants) {
      let tenants: string[] = [];
      if (Array.isArray(flag.targetTenants)) {
        tenants = flag.targetTenants as string[];
      } else if (typeof flag.targetTenants === "string") {
        try {
          tenants = JSON.parse(flag.targetTenants);
        } catch {
          tenants = [flag.targetTenants];
        }
      }
      if (Array.isArray(tenants) && tenants.includes(context.tenantId)) {
        return true;
      }
    }

    // Check targetUsers scope if provided in context
    if (context?.userId && flag.targetUsers) {
      let users: string[] = [];
      if (Array.isArray(flag.targetUsers)) {
        users = flag.targetUsers as string[];
      } else if (typeof flag.targetUsers === "string") {
        try {
          users = JSON.parse(flag.targetUsers);
        } catch {
          users = [flag.targetUsers];
        }
      }
      if (Array.isArray(users) && users.includes(context.userId)) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error(`[getFlag] Error evaluating flag "${flagName}":`, error);
    return DEFAULT_FLAGS[flagName] ?? false;
  }
}

/**
 * Get all feature flags ordered by creation date (newest first).
 */
export async function getAllFlags(): Promise<FeatureFlag[]> {
  try {
    return await db.featureFlag.findMany({
      orderBy: { createdAt: "desc" },
    });
  } catch (error) {
    console.error("[getAllFlags] Error fetching flags:", error);
    return [];
  }
}

/**
 * Create or update a feature flag.
 */
export async function upsertFlag(data: FeatureFlagInput): Promise<FeatureFlag> {
  const targetTenantsValue =
    data.targetTenants !== undefined ? (data.targetTenants as Prisma.InputJsonValue) : undefined;
  const targetUsersValue =
    data.targetUsers !== undefined ? (data.targetUsers as Prisma.InputJsonValue) : undefined;

  if (data.id) {
    return await db.featureFlag.update({
      where: { id: data.id },
      data: {
        key: data.key,
        name: data.name,
        description: data.description ?? null,
        enabled: data.enabled ?? true,
        targetTenants: targetTenantsValue,
        targetUsers: targetUsersValue,
      },
    });
  }

  return await db.featureFlag.upsert({
    where: { key: data.key },
    create: {
      key: data.key,
      name: data.name,
      description: data.description ?? null,
      enabled: data.enabled ?? true,
      targetTenants: targetTenantsValue,
      targetUsers: targetUsersValue,
    },
    update: {
      name: data.name,
      description: data.description ?? null,
      enabled: data.enabled ?? true,
      ...(targetTenantsValue !== undefined && { targetTenants: targetTenantsValue }),
      ...(targetUsersValue !== undefined && { targetUsers: targetUsersValue }),
    },
  });
}

/**
 * Toggle enabled state of a feature flag.
 */
export async function toggleFlag(id: string, enabled: boolean): Promise<FeatureFlag> {
  return await db.featureFlag.update({
    where: { id },
    data: { enabled },
  });
}

/**
 * Delete a feature flag by ID.
 */
export async function deleteFlag(id: string): Promise<FeatureFlag> {
  return await db.featureFlag.delete({
    where: { id },
  });
}

