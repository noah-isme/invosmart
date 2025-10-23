"use client";

import { useCallback } from "react";
import type { MouseEvent } from "react";

type ConfirmActionDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  confirmTone?: "default" | "destructive";
  loading?: boolean;
};

export const ConfirmActionDialog = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Batal",
  onConfirm,
  onClose,
  confirmTone = "default",
  loading = false,
}: ConfirmActionDialogProps) => {
  const handleBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  if (!open) {
    return null;
  }

  const confirmClassName =
    confirmTone === "destructive"
      ? "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-destructive"
      : "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-primary";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="space-y-2">
          <h2 id="confirm-dialog-title" className="text-lg font-semibold">
            {title}
          </h2>
          <p id="confirm-dialog-description" className="text-sm text-muted-foreground">
            {description}
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${confirmClassName}`}
            disabled={loading}
          >
            {loading ? "Memproses..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
