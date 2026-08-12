"use client";

import { useState } from "react";
import { Globe, Check, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/context/ToastContext";
import { useTranslation, type Locale } from "@/lib/i18n";

export interface LanguageSettingsPanelProps {
  initialLocale?: Locale;
}

export function LanguageSettingsPanel({ initialLocale }: LanguageSettingsPanelProps) {
  const { locale, setLocale, t } = useTranslation();
  const { notify } = useToast();
  const [selectedLocale, setSelectedLocale] = useState<Locale>(initialLocale ?? locale ?? "en");
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      await setLocale(selectedLocale);
      const msg = t("settings.language.savedSuccess");
      setSuccessMsg(msg);
      notify({
        title: `🌐 ${t("settings.language.title")}`,
        description: msg,
        variant: "success",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("settings.language.savedError");
      setErrorMsg(msg);
      notify({
        title: `⚠️ ${t("common.error")}`,
        description: msg,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const languages: { code: Locale; labelKey: string; flag: string; nativeName: string }[] = [
    {
      code: "en",
      labelKey: "settings.language.en",
      flag: "🇺🇸",
      nativeName: "English",
    },
    {
      code: "id",
      labelKey: "settings.language.id",
      flag: "🇮🇩",
      nativeName: "Bahasa Indonesia",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_0_24px_rgba(0,0,0,0.25)] backdrop-blur-md space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-text flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            {t("settings.language.subtitle")}
          </h2>
          <p className="text-sm text-text/65">
            {t("settings.language.description")}
          </p>
        </div>

        <div className="space-y-3">
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.32em] text-text/55">
            {t("settings.language.activeLanguage")}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {languages.map((lang) => {
              const isSelected = selectedLocale === lang.code;
              return (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => setSelectedLocale(lang.code)}
                  className={`group relative flex items-center justify-between rounded-2xl border p-4 text-left transition-all duration-200 ${
                    isSelected
                      ? "border-primary bg-primary/10 text-text shadow-[0_0_20px_rgba(var(--color-primary)_/_0.2)]"
                      : "border-white/10 bg-white/[0.03] text-text/70 hover:border-white/20 hover:bg-white/[0.06]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{lang.flag}</span>
                    <div>
                      <p className="font-semibold text-text">{lang.nativeName}</p>
                      <p className="text-xs text-text/55">{t(lang.labelKey)}</p>
                    </div>
                  </div>
                  {isSelected && (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white shadow-md">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {errorMsg && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {successMsg}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="w-full sm:w-auto"
          >
            {saving ? t("common.saving") : t("settings.language.saveButton")}
          </Button>
        </div>
      </div>

      <aside className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_0_24px_rgba(0,0,0,0.18)] backdrop-blur-md space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/20 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-text/55">Preview</p>
            <p className="text-base font-semibold text-text">i18n Live Demo</p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/0 p-4 space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-text/45">Sample Translation Keys</p>
          <div className="space-y-1 text-sm">
            <p className="text-text/70">
              <span className="font-mono text-xs text-primary/80">common.save</span>:{" "}
              <span className="font-medium text-text">{t("common.save")}</span>
            </p>
            <p className="text-text/70">
              <span className="font-mono text-xs text-primary/80">common.cancel</span>:{" "}
              <span className="font-medium text-text">{t("common.cancel")}</span>
            </p>
            <p className="text-text/70">
              <span className="font-mono text-xs text-primary/80">invoices.status.paid</span>:{" "}
              <span className="font-medium text-text">{t("invoices.status.paid")}</span>
            </p>
            <p className="text-text/70">
              <span className="font-mono text-xs text-primary/80">common.welcome</span>:{" "}
              <span className="font-medium text-text">{t("common.welcome", { name: "User" })}</span>
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
