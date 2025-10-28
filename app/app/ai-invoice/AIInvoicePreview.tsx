"use client";

import { motion } from "framer-motion";
import dynamic from "next/dynamic";

import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import type { InvoiceFormInitialValues } from "@/components/invoices/InvoiceFormClient";

const InvoiceFormClient = dynamic(
  () =>
    import("@/components/invoices/InvoiceFormClient").then(
      (mod) => mod.InvoiceFormClient,
    ),
  {
    ssr: false,
    loading: () => (
      <section className="glass-surface space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-6">
        <Skeleton className="h-6 w-40" />
        <SkeletonText lines={4} />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-28" />
        </div>
      </section>
    ),
  },
);

type AIInvoicePreviewProps = {
  ready: boolean;
  loading: boolean;
  draft: InvoiceFormInitialValues;
};

export const AIInvoicePreview = ({ ready, loading, draft }: AIInvoicePreviewProps) => {
  if (!ready) {
    return (
      <section className="glass-surface rounded-[28px] border border-dashed border-white/15 bg-white/[0.04] p-8 text-sm text-text/70">
        <h2 className="text-xl font-semibold text-text">Belum ada draft invoice</h2>
        <p className="mt-3 leading-relaxed text-text/70">
          Masukkan instruksi pada form di atas untuk membiarkan AI menyusun draft invoice. Anda dapat menyunting setiap detail
          sebelum menyimpan atau mengirimnya.
        </p>
        <p className="mt-4 text-xs text-text/50">
          Tips: cantumkan nama klien, layanan atau produk, kuantitas, serta tenggat pembayaran untuk hasil yang akurat.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-surface rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-text/70"
        >
          AI sedang menyusun draft invoice berdasarkan instruksi Anda...
        </motion.div>
      ) : null}
      <InvoiceFormClient
        heading="Review draft invoice"
        description="Periksa detail hasil AI, lakukan penyesuaian, lalu simpan atau kirim invoice."
        initialValues={draft}
      />
    </div>
  );
};

