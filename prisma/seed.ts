import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

import {
  createUserWithPersonalWorkspace,
  ensurePersonalWorkspace,
  type WorkspaceDatabase,
} from "../lib/workspace-provisioning";

const db = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash("demo123", 10);
  
  const workspaceClient = db as unknown as WorkspaceDatabase;
  const email = "demo@invosmart.dev";

  // The demo account gets a personal workspace like any real signup, so it
  // works under WORKSPACE_AUTH_MODE=enforce.
  const existing = await db.user.findUnique({ where: { email } });
  const user = existing
    ? await db.user.update({ where: { id: existing.id }, data: { password: hashedPassword } })
    : await createUserWithPersonalWorkspace<{ id: string; name: string | null; email: string }>(
        { email, name: "Demo User", password: hashedPassword },
        workspaceClient,
      );

  if (existing) {
    await ensurePersonalWorkspace(user.id, user, workspaceClient);
  }

  const membership = await db.membership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  const existingInvoice = await db.invoice.findFirst({
    where: { number: "INV-2025-001", userId: user.id },
  });

  if (!existingInvoice) {
    await db.invoice.create({
      data: {
        number: "INV-2025-001",
        client: "PT Contoh Sejahtera",
        items: [{ name: "Desain Logo", qty: 1, price: 2_000_000 }],
        subtotal: 2_000_000,
        tax: 200_000,
        total: 2_200_000,
        status: "DRAFT",
        issuedAt: new Date(),
        userId: user.id,
        organizationId: membership?.organizationId,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
