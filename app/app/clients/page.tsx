import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import ClientsClient from "./ClientsClient";
import { resolveWorkspaceContext, workspaceScope } from "@/lib/workspaces";

export const metadata = {
  title: "Clients | InvoSmart",
};

export default async function ClientsPage() {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.id) {
    redirect("/auth/login");
  }

  const workspace = await resolveWorkspaceContext(session.user.id);
  if (!workspace) {
    redirect("/app/workspaces");
  }
  const scope = workspaceScope(workspace);

  const initialClients = await db.client.findMany({
    where: scope,
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { invoices: true } }
    }
  });

  const clientsWithRevenue = await Promise.all(initialClients.map(async (client) => {
    const agg = await db.invoice.aggregate({
      where: { clientId: client.id, ...scope, status: 'PAID' },
      _sum: { total: true }
    });
    return {
      ...client,
      revenue: agg._sum.total || 0,
      invoiceCount: client._count.invoices
    };
  }));

  return <ClientsClient initialClients={clientsWithRevenue} />;
}
