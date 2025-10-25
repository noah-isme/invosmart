"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { InvoiceStatusEnum, type InvoiceStatusValue } from "@/lib/schemas";
import { trackEvent } from "@/lib/telemetry";

import { InvoiceItemsTable } from "./InvoiceItemsTable";
import { InvoiceSummary } from "./InvoiceSummary";
import type { InvoiceDetail } from "./types";

type DialogType = "send" | "paid" | "delete" | null;

type DialogConfig = {
  title: string;
  description: string;
  confirmLabel: string;
  confirmTone?: "default" | "destructive";
  status?: InvoiceStatusValue;
};

const dialogConfigs: Record<Exclude<DialogType, null>, DialogConfig> = {
  send: {
    title: "Kirim Invoice",
    description:
      "Invoice akan dikirim ke klien dan status berubah menjadi SENT. Pastikan seluruh data sudah benar.",
    confirmLabel: "Kirim",
    status: InvoiceStatusEnum.enum.SENT,
  },
  paid: {
    title: "Tandai Sebagai Lunas",
    description:
      "Pastikan pembayaran telah diterima. Status akan diperbarui menjadi PAID dan tanggal pembayaran dicatat otomatis.",
    confirmLabel: "Tandai Lunas",
    status: InvoiceStatusEnum.enum.PAID,
  },
  delete: {
    title: "Hapus Invoice",
    description: "Tindakan ini tidak dapat dibatalkan. Invoice akan dihapus permanen dari sistem.",
    confirmLabel: "Hapus",
    confirmTone: "destructive",
  },
};

type InvoiceDetailClientProps = {
  initialInvoice: InvoiceDetail;
};

export const InvoiceDetailClient = ({ initialInvoice }: InvoiceDetailClientProps) => {
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceDetail>(initialInvoice);
  const [dialog, setDialog] = useState<DialogType>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadPending, setDownloadPending] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);

  const dialogConfig = useMemo(() => (dialog ? dialogConfigs[dialog] : null), [dialog]);

  const canSend = invoice.status === InvoiceStatusEnum.enum.DRAFT;
  const canMarkPaid = invoice.status !== InvoiceStatusEnum.enum.PAID;

  const closeDialog = () => {
    setDialog(null);
  };

  const openDialog = (type: Exclude<DialogType, null>) => {
    setError(null);
    setDialog(type);
  };

  const handleDownload = async () => {
    setDownloadPending(true);
    setDownloadError(null);
    setDownloadMessage(null);

    let blobUrl: string | null = null;

    try {
      const response = await fetch(`/api/invoices/${invoice.id}/pdf`);

      if (!response.ok) {
        throw new Error("Gagal mengunduh PDF. Silakan coba lagi.");
      }

      const blob = await response.blob();
      blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `invoice-${invoice.number}.pdf`;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setDownloadMessage("PDF berhasil diunduh.");
      trackEvent("invoice_pdf_exported", {
        invoiceId: invoice.id,
        number: invoice.number,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal mengunduh PDF.";
      setDownloadError(message);
    } finally {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
      setDownloadPending(false);
    }
  };

  const updateInvoice = async (status: InvoiceStatusValue) => {
    const response = await fetch(`/api/invoices/${invoice.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: invoice.id,
        client: invoice.client,
        items: invoice.items,
        subtotal: invoice.subtotal,
        tax: invoice.tax,
        total: invoice.total,
        status,
        issuedAt: invoice.issuedAt,
        dueAt: invoice.dueAt,
        notes: invoice.notes,
        taxRate: 0.1,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error ?? "Gagal memperbarui invoice.");
    }

    const payload = (await response.json()) as { data: InvoiceDetail };
    setInvoice(payload.data);
    trackEvent("invoice_status_updated", {
      invoiceId: invoice.id,
      status: payload.data.status,
    });
    if (payload.data.status === InvoiceStatusEnum.enum.PAID) {
      trackEvent("invoice_paid", {
        invoiceId: invoice.id,
        total: payload.data.total,
      });
    }
    router.refresh();
  };

  const deleteInvoice = async () => {
    const response = await fetch(`/api/invoices/${invoice.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error ?? "Gagal menghapus invoice.");
    }

    router.push("/app/dashboard");
    router.refresh();
    trackEvent("invoice_deleted", {
      invoiceId: invoice.id,
    });
  };

  const handleConfirm = async () => {
    if (!dialogConfig) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      if (dialog === "delete") {
        await deleteInvoice();
      } else if (dialogConfig.status) {
        await updateInvoice(dialogConfig.status);
      }

      closeDialog();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Terjadi kesalahan.";
      setError(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Detail Invoice</h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
            disabled={downloadPending}
            aria-busy={downloadPending}
          >
            {downloadPending ? "Menyiapkan PDF..." : "Download PDF"}
          </button>
          <button
            type="button"
            onClick={() => openDialog("send")}
            className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canSend || pending}
          >
            Kirim Invoice
          </button>
          <button
            type="button"
            onClick={() => openDialog("paid")}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canMarkPaid || pending}
          >
            Tandai Lunas
          </button>
          <button
            type="button"
            onClick={() => openDialog("delete")}
            className="inline-flex items-center rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
          >
            Hapus Invoice
          </button>
        </div>
      </div>

      <div className="space-y-3" aria-live="polite" role="status">
        {downloadError ? (
          <p className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            {downloadError}
          </p>
        ) : null}
        {downloadMessage ? (
          <p className="rounded-md border border-emerald-600/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">
            {downloadMessage}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <InvoiceSummary invoice={invoice} />
      <InvoiceItemsTable
        items={invoice.items}
        subtotal={invoice.subtotal}
        tax={invoice.tax}
        total={invoice.total}
      />

      {dialogConfig ? (
        <ConfirmActionDialog
          open={dialog !== null}
          title={dialogConfig.title}
          description={dialogConfig.description}
          confirmLabel={dialogConfig.confirmLabel}
          confirmTone={dialogConfig.confirmTone}
          loading={pending}
          onConfirm={handleConfirm}
          onClose={closeDialog}
        />
      ) : null}
    </div>
  );
};
