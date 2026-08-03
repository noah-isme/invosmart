"use client";

import { useState, useRef, ChangeEvent } from "react";
import { UploadCloud, Camera, CheckCircle2, AlertCircle } from "lucide-react";
import { z } from "zod";

type ReceiptData = {
  client: string;
  items: { name: string; qty: number; price: number }[];
  dueAt: string | null;
  notes: string;
};

export const ReceiptScanner = ({
  onScanSuccess,
}: {
  onScanSuccess?: (data: ReceiptData) => void;
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReceiptData | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processImage = async (base64Image: string) => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/receipts/ai-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64Image }),
      });

      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.error || "Gagal memindai struk.");
      }

      setResult(body.data);
      if (onScanSuccess) {
        onScanSuccess(body.data);
      }
    } catch (err: any) {
      setError(err.message || "Terjadi kesalahan saat memproses gambar.");
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Hanya file gambar yang diperbolehkan.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setPreview(base64);
      processImage(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Hanya file gambar yang diperbolehkan.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setPreview(base64);
      processImage(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }

  return (
    <div className="space-y-6">
      <div
        className="glass-surface relative overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.04] p-8 shadow-[0_28px_70px_rgba(8,10,16,0.55)] transition-colors hover:bg-white/[0.06] hover:border-white/20"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <div className="flex flex-col items-center justify-center space-y-4 text-center">
          <div className="flex gap-4">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 border border-white/10 transition-colors hover:bg-white/10"
            >
              <UploadCloud className="h-8 w-8 text-primary" />
            </button>
            <button
              onClick={() => {
                if (fileInputRef.current) {
                  fileInputRef.current.setAttribute("capture", "environment");
                  fileInputRef.current.click();
                  fileInputRef.current.removeAttribute("capture");
                }
              }}
              disabled={loading}
              className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 border border-white/10 transition-colors hover:bg-white/10"
            >
              <Camera className="h-8 w-8 text-primary" />
            </button>
          </div>

          <div>
            <h3 className="text-lg font-medium text-text">Pindai Struk / Receipt</h3>
            <p className="mt-1 text-sm text-text/60">
              Unggah gambar atau gunakan kamera untuk mengekstrak data invoice secara otomatis.
            </p>
          </div>
        </div>

        <input
          type="file"
          accept="image/*"
          className="hidden"
          ref={fileInputRef}
          onChange={handleFileChange}
        />
      </div>

      {preview && (
        <div className="flex flex-col md:flex-row gap-6">
          <div className="w-full md:w-1/3">
             <div className="rounded-2xl border border-white/10 overflow-hidden bg-black/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Receipt preview" className="w-full h-auto object-contain max-h-[400px]" />
             </div>
          </div>

          <div className="w-full md:w-2/3 space-y-4">
            {loading && (
              <div className="flex items-center gap-3 text-text/70 animate-pulse">
                <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <span>Memproses gambar dengan AI...</span>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-red-400">
                <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            {result && !loading && (
              <div className="space-y-4 rounded-2xl border border-green-500/20 bg-green-500/5 p-6">
                <div className="flex items-center gap-2 text-green-400 font-medium mb-4">
                  <CheckCircle2 className="h-5 w-5" />
                  <h3>Data berhasil diekstrak!</h3>
                </div>

                <div className="space-y-3">
                  <div>
                    <span className="text-xs text-text/50 uppercase tracking-wider">Klien / Vendor</span>
                    <p className="text-base font-medium text-text mt-1">{result.client}</p>
                  </div>

                  {result.notes && (
                    <div>
                      <span className="text-xs text-text/50 uppercase tracking-wider">Catatan</span>
                      <p className="text-sm text-text/80 mt-1">{result.notes}</p>
                    </div>
                  )}

                  <div>
                    <span className="text-xs text-text/50 uppercase tracking-wider block mb-2">Item</span>
                    <ul className="space-y-2">
                      {result.items.map((item, idx) => (
                        <li key={idx} className="flex justify-between items-center bg-white/5 p-3 rounded-xl border border-white/5">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-text/90">{item.name}</span>
                            <span className="text-xs text-text/50">Qty: {item.qty}</span>
                          </div>
                          <span className="text-sm font-medium text-text">
                            {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(item.price)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-4 mt-4 border-t border-white/10 flex justify-between items-center">
                    <span className="text-sm font-medium text-text/70">Total Estimation</span>
                    <span className="text-lg font-bold text-primary">
                      {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(
                        result.items.reduce((acc, item) => acc + (item.price * item.qty), 0)
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
