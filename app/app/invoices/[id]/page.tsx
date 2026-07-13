import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { InvoiceDetailClient } from "./InvoiceDetailClient";
import type { InvoiceDetail } from "./types";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function InvoiceDetailPage({ params }: PageProps) {
  const resolved = await params;
  const id = resolved.id;
  const cookieHeader = cookies().toString();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "http://127.0.0.1:3000";
  const response = await fetch(`${baseUrl}/api/invoices/${id}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    cache: "no-store",
  });

  if (response.status === 404) {
    notFound();
  }

  if (!response.ok) {
    throw new Error("Failed to load invoice detail");
  }

  const payload = (await response.json()) as { data: InvoiceDetail };

  if (!payload?.data) {
    notFound();
  }

  return <InvoiceDetailClient initialInvoice={payload.data} />;
}
