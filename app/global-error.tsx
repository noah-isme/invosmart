'use client';

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

import { Button } from "@/components/ui/Button";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="id">
      <body className="bg-bg text-text">
        <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-accent">Terjadi kesalahan</p>
            <h1 className="text-3xl font-semibold sm:text-4xl">Ups! Ada yang tidak beres.</h1>
            <p className="mx-auto max-w-md text-sm text-text/70">
              Kami sudah menerima laporan otomatis mengenai masalah ini. Coba muat ulang halaman atau
              kembali ke beranda.
            </p>
            {error.digest ? (
              <p className="text-xs text-text/40">Kode referensi: {error.digest}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={() => reset()}>Coba lagi</Button>
            <Button
              variant="secondary"
              onClick={() => {
                window.location.assign("/");
              }}
            >
              Kembali ke beranda
            </Button>
          </div>
        </div>
      </body>
    </html>
  );
}
