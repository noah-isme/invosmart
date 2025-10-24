"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { InvoiceFormSchema, InvoiceStatusEnum } from "@/lib/schemas";
import { calculateTotals, type InvoiceItemInput } from "@/lib/invoice-utils";

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const DEFAULT_TAX_RATE = 0.1;

export type InvoiceFormInitialValues = {
  client?: string | null;
  dueAt?: string | null;
  notes?: string | null;
  items?: Array<{
    name?: string | null;
    qty?: number | string | null;
    price?: number | string | null;
  }>;
};

type InvoiceItemForm = {
  name: string;
  qty: string;
  price: string;
};

type ItemError = Partial<Record<keyof InvoiceItemForm, string>>;

type FormErrors = {
  client?: string;
  dueAt?: string;
  notes?: string;
  items: ItemError[];
  form?: string;
};

const createEmptyItem = (): InvoiceItemForm => ({ name: "", qty: "1", price: "0" });

const createItemErrors = (count: number): ItemError[] =>
  Array.from({ length: count }, () => ({}));

const emptyErrors = (count: number): FormErrors => ({
  client: undefined,
  dueAt: undefined,
  notes: undefined,
  items: createItemErrors(count),
  form: undefined,
});

const toIsoString = (value: string) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString();
};

const mapValidationErrors = (
  result: ReturnType<typeof InvoiceFormSchema.safeParse>,
  itemCount: number,
) => {
  if (result.success) {
    return emptyErrors(itemCount);
  }

  const flattened = result.error.flatten();
  const errors: FormErrors = {
    client: flattened.fieldErrors.client?.[0],
    dueAt: flattened.fieldErrors.dueAt?.[0],
    notes: flattened.fieldErrors.notes?.[0],
    items: createItemErrors(itemCount),
    form: flattened.formErrors[0],
  };

  for (const issue of result.error.issues) {
    if (issue.path[0] === "items" && typeof issue.path[1] === "number") {
      const index = issue.path[1];
      const field = issue.path[2];

      if (
        typeof index === "number" &&
        index < errors.items.length &&
        (field === "name" || field === "qty" || field === "price")
      ) {
        errors.items[index] = {
          ...errors.items[index],
          [field]: issue.message,
        };
      }
    }
  }

  return errors;
};

const formatDueAtInput = (value: string | null | undefined) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const normalizeItems = (items: InvoiceItemForm[]): InvoiceItemInput[] =>
  items.map((item) => ({
    name: item.name.trim(),
    qty: Number.parseInt(item.qty, 10) || 0,
    price: Number.parseInt(item.price, 10) || 0,
  }));

const sanitizeInitialValues = (values?: InvoiceFormInitialValues): InvoiceItemForm[] => {
  if (!values?.items || values.items.length === 0) {
    return [createEmptyItem()];
  }

  return values.items.map((item) => ({
    name: item?.name?.toString() ?? "",
    qty: item?.qty !== undefined && item?.qty !== null ? String(item.qty) : "1",
    price: item?.price !== undefined && item?.price !== null ? String(item.price) : "0",
  }));
};

export type InvoiceFormClientProps = {
  heading: string;
  description: string;
  initialValues?: InvoiceFormInitialValues;
  submitLabels?: {
    draft: string;
    draftLoading: string;
    send: string;
    sendLoading: string;
  };
};

const defaultSubmitLabels = {
  draft: "Simpan sebagai Draft",
  draftLoading: "Menyimpan...",
  send: "Kirim Invoice",
  sendLoading: "Mengirim...",
};

type SubmitAction = "DRAFT" | "SEND";

export const InvoiceFormClient = ({
  heading,
  description,
  initialValues,
  submitLabels = defaultSubmitLabels,
}: InvoiceFormClientProps) => {
  const router = useRouter();

  const sanitizedInitialItems = useMemo(
    () => sanitizeInitialValues(initialValues),
    [initialValues],
  );

  const [form, setForm] = useState({
    client: initialValues?.client?.toString() ?? "",
    dueAt: formatDueAtInput(initialValues?.dueAt),
    notes: initialValues?.notes?.toString() ?? "",
    items: sanitizedInitialItems,
  });

  const [errors, setErrors] = useState<FormErrors>(emptyErrors(sanitizedInitialItems.length));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const nextItems = sanitizeInitialValues(initialValues);
    setForm({
      client: initialValues?.client?.toString() ?? "",
      dueAt: formatDueAtInput(initialValues?.dueAt),
      notes: initialValues?.notes?.toString() ?? "",
      items: nextItems,
    });
    setErrors(emptyErrors(nextItems.length));
  }, [initialValues]);

  const normalizedItems = useMemo(
    () => normalizeItems(form.items),
    [form.items],
  );

  const totals = useMemo(
    () => calculateTotals(normalizedItems, DEFAULT_TAX_RATE),
    [normalizedItems],
  );

  const resetItemError = (index: number, field: keyof InvoiceItemForm) => {
    setErrors((prev) => {
      const nextItems = prev.items.slice();
      if (!nextItems[index]) {
        nextItems[index] = {};
      }
      nextItems[index] = { ...nextItems[index], [field]: undefined };
      return { ...prev, items: nextItems };
    });
  };

  const handleClientChange = (value: string) => {
    setForm((prev) => ({ ...prev, client: value }));
    setErrors((prev) => ({ ...prev, client: undefined, form: undefined }));
  };

  const handleDueAtChange = (value: string) => {
    setForm((prev) => ({ ...prev, dueAt: value }));
    setErrors((prev) => ({ ...prev, dueAt: undefined, form: undefined }));
  };

  const handleNotesChange = (value: string) => {
    setForm((prev) => ({ ...prev, notes: value }));
    setErrors((prev) => ({ ...prev, notes: undefined, form: undefined }));
  };

  const handleItemChange = (
    index: number,
    field: keyof InvoiceItemForm,
    value: string,
  ) => {
    setForm((prev) => {
      const nextItems = prev.items.map((item, idx) =>
        idx === index ? { ...item, [field]: value } : item,
      );
      return { ...prev, items: nextItems };
    });
    resetItemError(index, field);
  };

  const handleAddItem = () => {
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, createEmptyItem()],
    }));
    setErrors((prev) => ({
      ...prev,
      items: [...prev.items, {}],
    }));
  };

  const handleRemoveItem = (index: number) => {
    setForm((prev) => {
      if (prev.items.length === 1) {
        return prev;
      }

      const nextItems = prev.items.filter((_, idx) => idx !== index);
      return { ...prev, items: nextItems };
    });

    setErrors((prev) => {
      if (prev.items.length === 0) {
        return prev;
      }
      const nextItems = prev.items.filter((_, idx) => idx !== index);
      return { ...prev, items: nextItems };
    });
  };

  const submit = async (action: SubmitAction) => {
    setSubmitting(true);
    setErrors(emptyErrors(form.items.length));

    const payload = {
      client: form.client.trim(),
      items: normalizeItems(form.items),
      taxRate: DEFAULT_TAX_RATE,
      dueAt: toIsoString(form.dueAt),
      notes: form.notes.trim() ? form.notes.trim() : null,
    };

    const parsed = InvoiceFormSchema.safeParse(payload);

    if (!parsed.success) {
      setSubmitting(false);
      setErrors(mapValidationErrors(parsed, form.items.length));
      return;
    }

    try {
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...parsed.data,
          status:
            action === "SEND"
              ? InvoiceStatusEnum.enum.SENT
              : InvoiceStatusEnum.enum.DRAFT,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Gagal menyimpan invoice.");
      }

      const result = (await response.json()) as {
        data?: { id: string };
      };

      if (result?.data?.id) {
        router.push(`/app/invoices/${result.data.id}`);
      } else {
        router.push("/app/dashboard");
      }
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal menyimpan invoice.";
      setErrors({
        client: undefined,
        dueAt: undefined,
        notes: undefined,
        items: createItemErrors(form.items.length),
        form: message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (action: SubmitAction) => {
    void submit(action);
  };

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">{heading}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>

      <section className="space-y-6 rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Nama Klien</span>
            <input
              type="text"
              value={form.client}
              onChange={(event) => handleClientChange(event.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              placeholder="PT Kreatif Nusantara"
              aria-invalid={errors.client ? "true" : undefined}
              aria-describedby={errors.client ? "client-error" : undefined}
            />
            {errors.client ? (
              <span id="client-error" className="text-sm text-destructive">
                {errors.client}
              </span>
            ) : null}
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Jatuh Tempo</span>
            <input
              type="datetime-local"
              value={form.dueAt}
              onChange={(event) => handleDueAtChange(event.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              aria-invalid={errors.dueAt ? "true" : undefined}
              aria-describedby={errors.dueAt ? "dueAt-error" : undefined}
            />
            {errors.dueAt ? (
              <span id="dueAt-error" className="text-sm text-destructive">
                {errors.dueAt}
              </span>
            ) : null}
          </label>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Catatan (Opsional)</span>
          <textarea
            value={form.notes}
            onChange={(event) => handleNotesChange(event.target.value)}
            className="min-h-[96px] rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            placeholder="Tuliskan catatan tambahan untuk klien"
            aria-invalid={errors.notes ? "true" : undefined}
            aria-describedby={errors.notes ? "notes-error" : undefined}
          />
          {errors.notes ? (
            <span id="notes-error" className="text-sm text-destructive">
              {errors.notes}
            </span>
          ) : null}
        </label>

        <div className="space-y-4">
          <header className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Item Invoice</h2>
            <button
              type="button"
              onClick={handleAddItem}
              className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Tambah Item
            </button>
          </header>

          <div className="space-y-3">
            {form.items.map((item, index) => {
              const itemError = errors.items[index] ?? {};
              return (
                <div
                  key={`invoice-item-${index}`}
                  className="grid gap-3 rounded-md border border-border p-4 md:grid-cols-[2fr,1fr,1fr,auto]"
                >
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                      Nama Item
                    </span>
                    <input
                      type="text"
                      value={item.name}
                      onChange={(event) =>
                        handleItemChange(index, "name", event.target.value)
                      }
                      placeholder="Desain UI"
                      className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      aria-invalid={itemError.name ? "true" : undefined}
                      aria-describedby={
                        itemError.name ? `item-${index}-name-error` : undefined
                      }
                    />
                    {itemError.name ? (
                      <span
                        id={`item-${index}-name-error`}
                        className="text-xs text-destructive"
                      >
                        {itemError.name}
                      </span>
                    ) : null}
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                      Jumlah
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={item.qty}
                      onChange={(event) =>
                        handleItemChange(index, "qty", event.target.value)
                      }
                      className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      aria-invalid={itemError.qty ? "true" : undefined}
                      aria-describedby={
                        itemError.qty ? `item-${index}-qty-error` : undefined
                      }
                    />
                    {itemError.qty ? (
                      <span
                        id={`item-${index}-qty-error`}
                        className="text-xs text-destructive"
                      >
                        {itemError.qty}
                      </span>
                    ) : null}
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                      Harga (IDR)
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={item.price}
                      onChange={(event) =>
                        handleItemChange(index, "price", event.target.value)
                      }
                      className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      aria-invalid={itemError.price ? "true" : undefined}
                      aria-describedby={
                        itemError.price ? `item-${index}-price-error` : undefined
                      }
                    />
                    {itemError.price ? (
                      <span
                        id={`item-${index}-price-error`}
                        className="text-xs text-destructive"
                      >
                        {itemError.price}
                      </span>
                    ) : null}
                  </label>

                  <div className="flex items-end justify-end">
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(index)}
                      className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive disabled:opacity-60"
                      disabled={form.items.length === 1}
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <dl className="space-y-2 rounded-md border border-dashed border-border p-4 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="font-medium">{currencyFormatter.format(totals.subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Pajak (10%)</dt>
              <dd className="font-medium">{currencyFormatter.format(totals.tax)}</dd>
            </div>
            <div className="flex items-center justify-between text-base font-semibold">
              <dt>Total</dt>
              <dd>{currencyFormatter.format(totals.total)}</dd>
            </div>
          </dl>
        </div>

        {errors.form ? (
          <p className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            {errors.form}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 md:flex-row md:justify-end">
          <button
            type="button"
            onClick={() => handleSubmit("DRAFT")}
            className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
          >
            {submitting ? submitLabels.draftLoading : submitLabels.draft}
          </button>
          <button
            type="button"
            onClick={() => handleSubmit("SEND")}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
          >
            {submitting ? submitLabels.sendLoading : submitLabels.send}
          </button>
        </div>
      </section>
    </main>
  );
};

