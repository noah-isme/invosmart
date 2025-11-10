'use client';

import { useState } from 'react';

type ReceiptSettings = {
  positionPreset: 'bottom-left' | 'bottom-right' | 'center';
  enableCompanySeal: boolean;
  enablePaidStamp: boolean;
  enableSignature: boolean;
};

export default function ReceiptSettingsPage() {
  const [settings, setSettings] = useState<ReceiptSettings>({
    positionPreset: 'bottom-right',
    enableCompanySeal: false,
    enablePaidStamp: true,
    enableSignature: false,
  });

  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // In real implementation, this would persist to user preferences
    localStorage.setItem('receiptSettings', JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Receipt Settings</h1>
        <p className="mt-2 text-sm text-text/70">
          Konfigurasi default untuk bukti pembayaran (receipt)
        </p>
      </div>

      <div className="space-y-6 rounded-xl border border-white/10 bg-white/5 p-6">
        {/* Position Preset */}
        <div>
          <label className="block text-sm font-medium text-text">
            Posisi Stempel
          </label>
          <p className="mt-1 text-xs text-text/60">
            Tentukan di mana stempel akan ditempatkan pada receipt PDF
          </p>
          <select
            value={settings.positionPreset}
            onChange={(e) =>
              setSettings({
                ...settings,
                positionPreset: e.target.value as ReceiptSettings['positionPreset'],
              })
            }
            className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-text"
          >
            <option value="bottom-left">Kiri Bawah</option>
            <option value="bottom-right">Kanan Bawah</option>
            <option value="center">Tengah (Watermark)</option>
          </select>
        </div>

        {/* Company Seal */}
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-sm font-medium text-text">
              Stempel Perusahaan
            </label>
            <p className="mt-1 text-xs text-text/60">
              Tampilkan logo/stempel perusahaan
            </p>
          </div>
          <input
            type="checkbox"
            checked={settings.enableCompanySeal}
            onChange={(e) =>
              setSettings({ ...settings, enableCompanySeal: e.target.checked })
            }
            className="h-5 w-5"
          />
        </div>

        {/* PAID Stamp */}
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-sm font-medium text-text">
              Stempel LUNAS
            </label>
            <p className="mt-1 text-xs text-text/60">
              Tampilkan stempel &quot;LUNAS&quot; pada receipt
            </p>
          </div>
          <input
            type="checkbox"
            checked={settings.enablePaidStamp}
            onChange={(e) =>
              setSettings({ ...settings, enablePaidStamp: e.target.checked })
            }
            className="h-5 w-5"
          />
        </div>

        {/* Digital Signature */}
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-sm font-medium text-text">
              Tanda Tangan Digital
            </label>
            <p className="mt-1 text-xs text-text/60">
              Tambahkan blok tanda tangan digital
            </p>
          </div>
          <input
            type="checkbox"
            checked={settings.enableSignature}
            onChange={(e) =>
              setSettings({ ...settings, enableSignature: e.target.checked })
            }
            className="h-5 w-5"
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={handleSave}
          className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-white transition hover:bg-primary/90"
        >
          Simpan Pengaturan
        </button>
        {saved && (
          <span className="text-sm text-green-500">✓ Tersimpan</span>
        )}
      </div>

      <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
        <p className="text-xs text-blue-400">
          <strong>Note:</strong> Pengaturan ini akan menjadi default saat
          membuat receipt baru. Anda tetap bisa mengubahnya per receipt.
        </p>
      </div>
    </div>
  );
}
