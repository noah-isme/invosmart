"use client";

import { motion } from "framer-motion";
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

const labelClass =
  "text-[0.68rem] font-semibold uppercase tracking-[0.32em] text-text/55";
const inputClass =
  "w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
const subtleTextClass = "text-xs text-text/55";

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
    <main className="relative mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-20">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.42em] text-text/50">Workspace invoice</p>
        <h1 className="text-4xl font-semibold text-text">{heading}</h1>
        <p className="max-w-2xl text-base text-text/70">{description}</p>
      </header>

      <section className="glass-surface space-y-8 rounded-[30px] border border-white/5 bg-white/[0.04] p-8 shadow-[0_28px_70px_rgba(8,10,16,0.55)]">
        <div className="grid gap-6 lg:grid-cols-2">
          <label className="flex flex-col gap-3">
            <span className={labelClass}>Nama Klien</span>
            <input
              type="text"
              value={form.client}
              onChange={(event) => handleClientChange(event.target.value)}
              className={inputClass}
              placeholder="PT Kreatif Nusantara"
              aria-invalid={errors.client ? "true" : undefined}
              aria-describedby={errors.client ? "client-error" : undefined}
            />
            {errors.client ? (
              <span id="client-error" className="text-sm text-rose-300">
                {errors.client}
              </span>
            ) : null}
          </label>

          <label className="flex flex-col gap-3">
            <span className={labelClass}>Jatuh Tempo</span>
            <input
              type="datetime-local"
              value={form.dueAt}
              onChange={(event) => handleDueAtChange(event.target.value)}
              className={inputClass}
              aria-invalid={errors.dueAt ? "true" : undefined}
              aria-describedby={errors.dueAt ? "dueAt-error" : undefined}
            />
            {errors.dueAt ? (
              <span id="dueAt-error" className="text-sm text-rose-300">
                {errors.dueAt}
              </span>
            ) : null}
          </label>
        </div>

        <label className="flex flex-col gap-3">
          <span className={labelClass}>Catatan (opsional)</span>
          <textarea
            value={form.notes}
            onChange={(event) => handleNotesChange(event.target.value)}
            className={`${inputClass} min-h-[110px] resize-y`}
            placeholder="Tuliskan catatan tambahan untuk klien"
            aria-invalid={errors.notes ? "true" : undefined}
            aria-describedby={errors.notes ? "notes-error" : undefined}
          />
          {errors.notes ? (
            <span id="notes-error" className="text-sm text-rose-300">
              {errors.notes}
            </span>
          ) : null}
        </label>

        <div className="space-y-6">
          <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-text">Item invoice</h2>
              <p className={subtleTextClass}>Susun detail layanan atau produk yang ditagihkan.</p>
            </div>
            <motion.button
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={handleAddItem}
              className="gradient-button inline-flex items-center justify-center rounded-2xl px-4 py-2 text-sm font-semibold text-text"
            >
              Tambah item
            </motion.button>
          </header>

          <div className="space-y-4">
            {form.items.map((item, index) => {
              const itemError = errors.items[index] ?? {};

              return (
                <div
                  key={`invoice-item-${index}`}
                  className="grid gap-4 rounded-[24px] border border-white/8 bg-white/[0.03] p-5 shadow-[0_18px_45px_rgba(8,10,16,0.4)] md:grid-cols-[2fr,1fr,1fr,auto]"
                >
                  <label className="flex flex-col gap-2">
                    <span className={labelClass}>Nama item</span>
                    <input
                      type="text"
                      value={item.name}
                      onChange={(event) => handleItemChange(index, "name", event.target.value)}
                      placeholder="Desain UI"
                      className={inputClass}
                      aria-invalid={itemError.name ? "true" : undefined}
                      aria-describedby={itemError.name ? `item-${index}-name-error` : undefined}
                    />
                    {itemError.name ? (
                      <span id={`item-${index}-name-error`} className="text-xs text-rose-300">
                        {itemError.name}
                      </span>
                    ) : null}
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className={labelClass}>Jumlah</span>
                    <input
                      type="number"
                      min={1}
                      value={item.qty}
                      onChange={(event) => handleItemChange(index, "qty", event.target.value)}
                      className={inputClass}
                      aria-invalid={itemError.qty ? "true" : undefined}
                      aria-describedby={itemError.qty ? `item-${index}-qty-error` : undefined}
                    />
                    {itemError.qty ? (
                      <span id={`item-${index}-qty-error`} className="text-xs text-rose-300">
                        {itemError.qty}
                      </span>
                    ) : null}
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className={labelClass}>Harga (IDR)</span>
                    <input
                      type="number"
                      min={0}
                      value={item.price}
                      onChange={(event) => handleItemChange(index, "price", event.target.value)}
                      className={inputClass}
                      aria-invalid={itemError.price ? "true" : undefined}
                      aria-describedby={itemError.price ? `item-${index}-price-error` : undefined}
                    />
                    {itemError.price ? (
                      <span id={`item-${index}-price-error`} className="text-xs text-rose-300">
                        {itemError.price}
                      </span>
                    ) : null}
                  </label>

                  <div className="flex items-end justify-end">
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(index)}
                      className="inline-flex items-center rounded-2xl border border-white/10 px-3 py-2 text-sm font-semibold text-rose-300 transition hover:border-rose-300/40 hover:text-rose-200 disabled:opacity-50"
                      disabled={form.items.length === 1}
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <dl className="grid gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] p-6 text-sm text-text/70">
            <div className="flex items-center justify-between">
              <dt>Subtotal</dt>
              <dd className="font-semibold text-text">{currencyFormatter.format(totals.subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Pajak (10%)</dt>
              <dd className="font-semibold text-text">{currencyFormatter.format(totals.tax)}</dd>
            </div>
            <div className="flex items-center justify-between text-base">
              <dt className="font-semibold text-text">Total</dt>
              <dd className="text-lg font-semibold text-text">{currencyFormatter.format(totals.total)}</dd>
            </div>
          </dl>
        </div>

        {errors.form ? (
          <p className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            {errors.form}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 text-sm md:flex-row md:justify-end">
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={() => handleSubmit("DRAFT")}
            className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2 font-semibold text-text/80 transition hover:border-white/20 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            disabled={submitting}
          >
            {submitting ? submitLabels.draftLoading : submitLabels.draft}
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={() => handleSubmit("SEND")}
            className="gradient-button inline-flex items-center justify-center rounded-2xl px-5 py-2 font-semibold text-text disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
          >
            {submitting ? submitLabels.sendLoading : submitLabels.send}
          </motion.button>
        </div>
      </section>
    </main>
  );
};
