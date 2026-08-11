import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import ClientDetailClient from "./ClientDetailClient";

export const metadata = {
  title: "Client Detail | InvoSmart",
};

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.id) {
    redirect("/auth/login");
  }

  const { id } = await params;
  
  const client = await db.client.findUnique({
    where: { id, userId: session.user.id },
    include: {
      invoices: {
        orderBy: { createdAt: 'desc' },
        take: 10
      }
    }
  });

  if (!client) {
    notFound();
  }

  const paidAgg = await db.invoice.aggregate({
    where: { clientId: id, status: 'PAID' },
    _sum: { total: true },
    _count: true
  });

  const outstandingAgg = await db.invoice.aggregate({
    where: { clientId: id, status: { in: ['UNPAID', 'OVERDUE', 'SENT'] } },
    _sum: { total: true },
    _count: true
  });

  const stats = {
    revenue: paidAgg._sum.total || 0,
    paidCount: paidAgg._count || 0,
    outstandingCount: outstandingAgg._count || 0,
    outstandingAmount: outstandingAgg._sum.total || 0,
    invoiceCount: client.invoices.length, // total history count from DB, let's just use what we have or count all
  };

  const totalInvoices = await db.invoice.count({ where: { clientId: id }});
  stats.invoiceCount = totalInvoices;

  return <ClientDetailClient client={client} stats={stats} />;
}
