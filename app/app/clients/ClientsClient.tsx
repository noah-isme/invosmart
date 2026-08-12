"use client";

import { useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/currency";

type ClientRow = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  currency: string;
  invoiceCount: number;
  revenue: number;
};

export default function ClientsClient({ initialClients }: { initialClients: ClientRow[] }) {
  const [search, setSearch] = useState("");
  const [clients] = useState(initialClients);

  const filteredClients = clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || (c.company && c.company.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">Clients</h1>
          <p className="text-[var(--muted-foreground)]">Manage your customers and track their invoices.</p>
        </div>
        <Link
          href="/app/clients/new"
          className="inline-flex items-center justify-center rounded-md bg-[var(--primary)] text-white px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:opacity-90"
        >
          + New Client
        </Link>
      </div>

      <div className="relative">
        <input
          type="text"
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
        />
      </div>

      {filteredClients.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--border)] border-dashed py-12 text-center bg-[var(--card)]">
          <h3 className="mt-4 text-lg font-semibold text-[var(--foreground)]">No clients found</h3>
          <p className="mb-4 mt-2 text-sm text-[var(--muted-foreground)]">
            {search ? "No clients match your search criteria." : "Get started by adding your first client."}
          </p>
          {!search && (
            <Link
              href="/app/clients/new"
              className="inline-flex items-center justify-center rounded-md bg-[var(--primary)] text-white px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:opacity-90"
            >
              Add Client
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredClients.map((client) => (
            <Link
              key={client.id}
              href={`/app/clients/${client.id}`}
              className="group rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm transition-all hover:border-[var(--primary)] hover:shadow-md block"
            >
              <h3 className="font-semibold text-lg text-[var(--foreground)] group-hover:text-[var(--primary)] transition-colors">{client.name}</h3>
              {client.company && <p className="text-sm text-[var(--muted-foreground)] mb-2">{client.company}</p>}
              {client.email && <p className="text-sm text-[var(--muted-foreground)]">{client.email}</p>}
              
              <div className="mt-4 pt-4 border-t border-[var(--border)] flex justify-between items-center text-sm">
                <div>
                  <p className="text-[var(--muted-foreground)]">Invoices</p>
                  <p className="font-medium text-[var(--foreground)]">{client.invoiceCount}</p>
                </div>
                <div className="text-right">
                  <p className="text-[var(--muted-foreground)]">Total Revenue</p>
                  <p className="font-medium text-[var(--foreground)]">{formatCurrency(client.revenue, client.currency)}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
