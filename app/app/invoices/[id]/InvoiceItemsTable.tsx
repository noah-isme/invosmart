import type { InvoiceItemInput } from "@/lib/invoice-utils";

import { formatCurrency } from "@/lib/currency";

type InvoiceItemsTableProps = {
  items: InvoiceItemInput[];
  subtotal: number;
  tax: number;
  total: number;
  currencyCode?: string;
};

export const InvoiceItemsTable = ({
  items,
  subtotal,
  tax,
  total,
  currencyCode = "IDR",
}: InvoiceItemsTableProps) => {
  return (
    <section className="overflow-hidden rounded-lg border border-border">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Item
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Jumlah
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Harga
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-background text-sm">
          {items.map((item, index) => (
            <tr key={`${item.name}-${index}`}>
              <td className="px-4 py-3">
                <p className="font-medium text-foreground">{item.name}</p>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{item.qty}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatCurrency(item.price, currencyCode)}
              </td>
              <td className="px-4 py-3 font-medium text-foreground">
                {formatCurrency(item.qty * item.price, currencyCode)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-muted/40 text-sm">
          <tr>
            <td className="px-4 py-3 font-medium" colSpan={3}>
              Subtotal
            </td>
            <td className="px-4 py-3 font-semibold">{formatCurrency(subtotal, currencyCode)}</td>
          </tr>
          <tr>
            <td className="px-4 py-3 font-medium" colSpan={3}>
              Pajak (10%)
            </td>
            <td className="px-4 py-3 font-semibold">{formatCurrency(tax, currencyCode)}</td>
          </tr>
          <tr>
            <td className="px-4 py-3 font-medium" colSpan={3}>
              Total
            </td>
            <td className="px-4 py-3 text-lg font-semibold">{formatCurrency(total, currencyCode)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
};
