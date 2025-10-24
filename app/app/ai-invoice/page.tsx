import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { AIInvoiceGeneratorClient } from "./AIInvoiceGeneratorClient";
import { authOptions } from "@/server/auth";

export default async function AIInvoicePage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/auth/login");
  }

  return (
    <div className="space-y-8 pb-12">
      <AIInvoiceGeneratorClient />
    </div>
  );
}

