import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/currency";
import { verifyInvoiceShareToken } from "@/lib/invoice-delivery";

type SharePageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
};

export default async function SharedInvoicePage({ params, searchParams }: SharePageProps) {
  const [{ id }, { token }] = await Promise.all([params, searchParams]);
  if (!verifyInvoiceShareToken(token, id)) notFound();

  const invoice = await db.invoice.findUnique({
    where: { id },
    include: { client_rel: true, user: true },
  });
  if (!invoice) notFound();

  const items = Array.isArray(invoice.items) ? invoice.items as Array<{
    name?: string;
    description?: string;
    qty?: number;
    quantity?: number;
    price?: number;
    amount?: number;
  }> : [];

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-background px-6 py-12 text-foreground">
      <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">InvoSmart</p>
            <h1 className="mt-2 text-3xl font-bold">Invoice {invoice.number}</h1>
            <p className="mt-1 text-muted-foreground">From {invoice.user.name || "Your Company"}</p>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium">{invoice.status}</span>
        </div>

        <div className="grid gap-6 border-b border-border py-6 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground">Bill to</p>
            <p className="font-semibold">{invoice.client_rel?.name || invoice.client}</p>
            {invoice.client_rel?.email ? <p className="text-sm text-muted-foreground">{invoice.client_rel.email}</p> : null}
          </div>
          <div className="sm:text-right">
            <p className="text-sm text-muted-foreground">Due date</p>
            <p className="font-semibold">{invoice.dueAt ? new Date(invoice.dueAt).toLocaleDateString("id-ID") : "—"}</p>
          </div>
        </div>

        <div className="overflow-x-auto py-6">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr><th className="pb-3">Item</th><th className="pb-3 text-right">Qty</th><th className="pb-3 text-right">Amount</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item, index) => {
                const qty = Number(item.qty ?? item.quantity ?? 1);
                const amount = Number(item.amount ?? qty * Number(item.price ?? 0));
                return <tr key={index}><td className="py-3">{item.name || item.description || "Item"}</td><td className="py-3 text-right">{qty}</td><td className="py-3 text-right">{formatCurrency(amount, invoice.currency)}</td></tr>;
              })}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto max-w-xs space-y-2 border-t border-border pt-4 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatCurrency(invoice.subtotal, invoice.currency)}</dd></div>
          <div className="flex justify-between"><dt>Tax</dt><dd>{formatCurrency(invoice.tax, invoice.currency)}</dd></div>
          <div className="flex justify-between text-lg font-bold"><dt>Total</dt><dd>{formatCurrency(invoice.total, invoice.currency)}</dd></div>
        </dl>

        {invoice.notes ? <p className="mt-6 rounded-xl bg-muted p-4 text-sm">{invoice.notes}</p> : null}
      </div>
    </main>
  );
}
