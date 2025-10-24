"use client";

import { InvoiceFormClient, type InvoiceFormInitialValues } from "@/components/invoices/InvoiceFormClient";

type AIInvoicePreviewProps = {
  ready: boolean;
  loading: boolean;
  draft: InvoiceFormInitialValues;
};

export const AIInvoicePreview = ({ ready, loading, draft }: AIInvoicePreviewProps) => {
  if (!ready) {
    return (
      <section className="rounded-2xl border border-dashed border-border/70 bg-background/40 p-8 text-sm text-muted-foreground">
        <h2 className="text-lg font-semibold text-foreground">Belum ada draft invoice</h2>
        <p className="mt-2 leading-relaxed">
          Masukkan instruksi Anda pada form di atas. Sistem AI akan menghasilkan draft invoice yang dapat Anda review dan edit
          sebelum disimpan.
        </p>
        <p className="mt-3 text-xs text-muted-foreground/80">
          Tips: cantumkan nama klien, jenis layanan, jumlah item, serta tenggat pembayaran untuk hasil yang lebih akurat.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-border bg-background/60 px-4 py-3 text-sm text-muted-foreground"
        >
          AI sedang menyusun draft invoice berdasarkan instruksi Anda...
        </div>
      ) : null}
      <InvoiceFormClient
        heading="Review Draft Invoice"
        description="Periksa detail hasil AI, lakukan penyesuaian, lalu simpan atau kirim invoice."
        initialValues={draft}
      />
    </div>
  );
};

