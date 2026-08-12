import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import TemplatesClient from "./TemplatesClient";

export const metadata = {
  title: "Template Invoice | InvoSmart",
};

export default async function InvoiceTemplatesPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/auth/login");
  }

  const initialTemplates = await db.invoiceTemplate.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return <TemplatesClient initialTemplates={initialTemplates} />;
}
