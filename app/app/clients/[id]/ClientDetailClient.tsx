"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/currency";

type InvoiceRow = {
  id: string;
  number: string;
  status: string;
  issuedAt: string | Date;
  total: number;
  currency: string;
};

type ClientData = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxId: string | null;
  currency: string;
  notes: string | null;
  invoices: InvoiceRow[];
};

type ClientStats = {
  invoiceCount: number;
  totalRevenue: number;
  paidCount: number;
  unpaidRevenue: number;
};

export default function ClientDetailClient({ client, stats }: { client: ClientData, stats: ClientStats }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (stats.invoiceCount > 0) {
      alert("Cannot delete client with existing invoices.");
      return;
    }

    if (!confirm("Are you sure you want to delete this client?")) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/clients/${client.id}`, { method: 'DELETE' });
      if (res.ok) {
        router.push("/app/clients");
        router.refresh();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to delete client");
      }
    } catch {
      alert("An error occurred.");
    }
    setIsDeleting(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
        <Link href="/app/clients" className="hover:text-[var(--foreground)]">Clients</Link>
        <span>/</span>
        <span className="text-[var(--foreground)] font-medium">{client.name}</span>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">{client.name}</h1>
          {client.company && <p className="text-[var(--muted-foreground)]">{client.company}</p>}
        </div>
        <div className="flex gap-2">
          <Link
            href={`/app/clients/new?edit=${client.id}`}
            className="inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-[var(--muted)]"
          >
            Edit
          </Link>
          <button
            onClick={handleDelete}
            disabled={isDeleting || stats.invoiceCount > 0}
            title={stats.invoiceCount > 0 ? "Cannot delete client with existing invoices" : "Delete client"}
            className="inline-flex items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-600 px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-red-950/20 dark:border-red-900/50 dark:hover:bg-red-900/40"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="col-span-1 space-y-6">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
            <h3 className="font-semibold text-[var(--foreground)] mb-4">Contact Info</h3>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[var(--muted-foreground)]">Email</p>
                <p className="font-medium text-[var(--foreground)]">{client.email || "-"}</p>
              </div>
              <div>
                <p className="text-[var(--muted-foreground)]">Phone</p>
                <p className="font-medium text-[var(--foreground)]">{client.phone || "-"}</p>
              </div>
              <div>
                <p className="text-[var(--muted-foreground)]">Address</p>
                <p className="font-medium text-[var(--foreground)]">{client.address || "-"}</p>
              </div>
              <div>
                <p className="text-[var(--muted-foreground)]">Tax ID</p>
                <p className="font-medium text-[var(--foreground)]">{client.taxId || "-"}</p>
              </div>
              <div>
                <p className="text-[var(--muted-foreground)]">Currency</p>
                <p className="font-medium text-[var(--foreground)]">{client.currency}</p>
              </div>
              {client.notes && (
                <div>
                  <p className="text-[var(--muted-foreground)]">Notes</p>
                  <p className="font-medium text-[var(--foreground)]">{client.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-span-2 space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
              <p className="text-sm text-[var(--muted-foreground)]">Total Revenue</p>
              <p className="text-2xl font-bold mt-1 text-[var(--foreground)]">{formatCurrency(stats.revenue, client.currency)}</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
              <p className="text-sm text-[var(--muted-foreground)]">Outstanding</p>
              <p className="text-2xl font-bold mt-1 text-[var(--foreground)]">{formatCurrency(stats.outstandingAmount, client.currency)}</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
              <p className="text-sm text-[var(--muted-foreground)]">Invoices</p>
              <p className="text-2xl font-bold mt-1 text-[var(--foreground)]">{stats.invoiceCount}</p>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-sm">
            <div className="p-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--muted)]/30">
              <h3 className="font-semibold text-[var(--foreground)]">Recent Invoices</h3>
              <Link href={`/app/invoices?client=${client.id}`} className="text-sm text-[var(--primary)] hover:underline">View all</Link>
            </div>
            {client.invoices.length === 0 ? (
              <div className="p-6 text-center text-[var(--muted-foreground)] text-sm">
                No invoices found for this client.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-[var(--muted-foreground)] bg-[var(--muted)]/50">
                    <tr>
                      <th className="px-4 py-3 font-medium">Number</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {client.invoices.map((inv: InvoiceRow) => (
                      <tr key={inv.id} className="hover:bg-[var(--muted)]/30">
                        <td className="px-4 py-3">
                          <Link href={`/app/invoices/${inv.id}`} className="font-medium text-[var(--primary)] hover:underline">
                            {inv.number}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--primary)]/10 text-[var(--primary)]`}>
                            {inv.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[var(--muted-foreground)]">
                          {new Date(inv.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatCurrency(inv.total, inv.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
