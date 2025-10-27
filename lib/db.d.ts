import type { PrismaClient } from "@prisma/client";

// Export a declaration matching the runtime `lib/db.ts` singleton.
export const db: PrismaClient;
