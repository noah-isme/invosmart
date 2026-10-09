import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { getClientIp } from "@/lib/audit/auditLogger";
import { getInvoiceForCurrentUser } from "@/lib/invoices/get-invoice";

import { InvoiceDetailClient } from "./InvoiceDetailClient";
import type { InvoiceDetail } from "./types";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function InvoiceDetailPage({ params }: PageProps) {
  const resolved = await params;
  const id = resolved.id;

  // Load straight from the shared data-access function instead of self-fetching its
  // own API: a server-side fetch carries no client IP, so every
  // viewer would share one rate-limit bucket. Authorization is identical to the
  // API route because both call the same function.
  const result = await getInvoiceForCurrentUser({
    id,
    ipAddress: getClientIp({ headers: headers() } as unknown as Request),
  });

  if (!result.ok) {
    if (result.reason === "unauthorized") {
      redirect("/auth/login");
    }
    if (result.reason === "not_found" || result.reason === "invalid_id") {
      notFound();
    }
    throw new Error("Failed to load invoice detail");
  }

  // Same wire shape the API returned (dates as ISO strings, no class instances)
  // so the client component receives identical props.
  const invoice = JSON.parse(JSON.stringify(result.invoice)) as InvoiceDetail;

  return <InvoiceDetailClient initialInvoice={invoice} />;
}
