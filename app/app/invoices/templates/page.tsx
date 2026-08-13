import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import TemplatesClient from "./TemplatesClient";
import { resolveWorkspaceContext } from "@/lib/workspaces";

export const metadata = {
  title: "Template Invoice | InvoSmart",
};

export default async function InvoiceTemplatesPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/auth/login");
  }

  const workspace = await resolveWorkspaceContext(session.user.id);
  if (!workspace) {
    redirect("/app/workspaces");
  }

  const initialTemplates = await db.invoiceTemplate.findMany({
    where: workspace.organizationId ? { organizationId: workspace.organizationId } : { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return <TemplatesClient initialTemplates={initialTemplates} />;
}
