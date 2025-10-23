"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AuthCard } from "@/components/auth/AuthCard";
import { FormError } from "@/components/auth/FormError";
import { RegisterSchema, type RegisterSchemaInput } from "@/lib/schemas";

type FieldErrors = Partial<Record<keyof RegisterSchemaInput, string>>;

export default function RegisterPage() {
  const router = useRouter();

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const rawValues: RegisterSchemaInput = {
      name: typeof formData.get("name") === "string" ? (formData.get("name") as string) : "",
      email: typeof formData.get("email") === "string" ? (formData.get("email") as string) : "",
      password:
        typeof formData.get("password") === "string" ? (formData.get("password") as string) : "",
    };

    const parsed = RegisterSchema.safeParse(rawValues);

    if (!parsed.success) {
      const { fieldErrors: parsedErrors } = parsed.error.flatten();

      setFieldErrors({
        name: parsedErrors.name?.[0],
        email: parsedErrors.email?.[0],
        password: parsedErrors.password?.[0],
      });
      setFormError("Periksa kembali data yang Anda masukkan.");
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parsed.data),
      });

      if (response.ok) {
        setIsSubmitting(false);
        router.push("/auth/login?registered=1");
        router.refresh();
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (response.status === 409) {
        setFormError(payload?.error ?? "Email sudah terdaftar. Silakan gunakan email lain.");
      } else if (response.status === 400) {
        setFormError(payload?.error ?? "Data registrasi tidak valid.");
      } else {
        setFormError(payload?.error ?? "Terjadi kesalahan saat registrasi. Silakan coba lagi.");
      }

      setIsSubmitting(false);
    } catch {
      setFormError("Terjadi kesalahan saat registrasi. Silakan coba lagi.");
      setIsSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Daftar akun baru"
      subtitle={
        <span>
          Sudah memiliki akun? {" "}
          <Link href="/auth/login" className="text-primary underline-offset-4 hover:underline">
            Masuk di sini
          </Link>
          .
        </span>
      }
    >
      <FormError message={formError} />

      <form className="space-y-6" onSubmit={handleSubmit} noValidate>
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium text-foreground">
            Nama lengkap
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "name-error" : undefined}
            disabled={isSubmitting}
          />
          {fieldErrors.name ? (
            <p id="name-error" className="text-xs text-destructive">
              {fieldErrors.name}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium text-foreground">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
            disabled={isSubmitting}
          />
          {fieldErrors.email ? (
            <p id="email-error" className="text-xs text-destructive">
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? "password-error" : undefined}
            disabled={isSubmitting}
          />
          {fieldErrors.password ? (
            <p id="password-error" className="text-xs text-destructive">
              {fieldErrors.password}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          className="flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-80"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? "Memproses..." : "Daftar"}
        </button>
      </form>
    </AuthCard>
  );
}
