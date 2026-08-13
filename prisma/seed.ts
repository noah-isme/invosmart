import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const db = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash("demo123", 10);
  
  const user = await db.user.upsert({
    where: { email: "demo@invosmart.dev" },
    update: {
      password: hashedPassword
    },
    create: { 
      email: "demo@invosmart.dev", 
      name: "Demo User",
      password: hashedPassword
    },
  });

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
