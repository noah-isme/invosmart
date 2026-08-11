import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import { InvoiceFormClient } from "@/components/invoices/InvoiceFormClient";

export default async function NewInvoicePage() {
  const session = await getServerSession(authOptions);
  let defaultCurrency = "IDR";
  
  if (session?.user?.id) {
    const user = await db.user.findUnique({ where: { id: session.user.id }, select: { defaultCurrency: true } });
    if (user?.defaultCurrency) {
      defaultCurrency = user.defaultCurrency;
    }
  }

  return (
    <InvoiceFormClient
      heading="Buat Invoice Manual"
      description="Lengkapi detail klien dan item layanan sebelum mengirim invoice."
      defaultCurrency={defaultCurrency}
    />
  );
}
