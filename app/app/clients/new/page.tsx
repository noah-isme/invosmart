import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import ClientFormClient from "./ClientFormClient";

export const metadata = {
  title: "New Client | InvoSmart",
};

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.id) {
    redirect("/auth/login");
  }

  const { edit } = await searchParams;
  let client = null;

  if (edit) {
    client = await db.client.findUnique({
      where: { id: edit, userId: session.user.id }
    });
  }

  return <ClientFormClient initialData={client ?? undefined} />;
}
