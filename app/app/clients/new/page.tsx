import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import ClientFormClient from "./ClientFormClient";
import { resolveWorkspaceContext, workspaceScope } from "@/lib/workspaces";

export const metadata = {
  title: "New Client | InvoSmart",
};

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.id) {
    redirect("/auth/login");
  }

  const workspace = await resolveWorkspaceContext(session.user.id);
  if (!workspace) {
    redirect("/app/workspaces");
  }
  const scope = workspaceScope(workspace);

  const { edit } = await searchParams;
  let client = null;

  if (edit) {
    client = await db.client.findUnique({
      where: { id: edit, ...scope }
    });
  }

  return <ClientFormClient initialData={client ?? undefined} />;
}
