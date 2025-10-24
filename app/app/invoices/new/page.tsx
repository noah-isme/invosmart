"use client";

import { InvoiceFormClient } from "@/components/invoices/InvoiceFormClient";

export default function NewInvoicePage() {
  return (
    <InvoiceFormClient
      heading="Buat Invoice Manual"
      description="Lengkapi detail klien dan item layanan sebelum mengirim invoice."
    />
  );
}

