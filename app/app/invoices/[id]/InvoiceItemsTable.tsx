import type { InvoiceItemInput } from "@/lib/invoice-utils";

const currency = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

type InvoiceItemsTableProps = {
  items: InvoiceItemInput[];
  subtotal: number;
  tax: number;
  total: number;
};

export const InvoiceItemsTable = ({
  items,
  subtotal,
  tax,
  total,
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
                {currency.format(item.price)}
              </td>
              <td className="px-4 py-3 font-medium text-foreground">
                {currency.format(item.qty * item.price)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-muted/40 text-sm">
          <tr>
            <td className="px-4 py-3 font-medium" colSpan={3}>
              Subtotal
            </td>
            <td className="px-4 py-3 font-semibold">{currency.format(subtotal)}</td>
          </tr>
          <tr>
            <td className="px-4 py-3 font-medium" colSpan={3}>
              Pajak (10%)
            </td>
            <td className="px-4 py-3 font-semibold">{currency.format(tax)}</td>
          </tr>
          <tr>
            <td className="px-4 py-3 font-medium" colSpan={3}>
              Total
            </td>
            <td className="px-4 py-3 text-lg font-semibold">{currency.format(total)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
};
