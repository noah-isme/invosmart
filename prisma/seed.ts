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

  const existingInvoice = await db.invoice.findUnique({
    where: { number: "INV-2025-001" },
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
