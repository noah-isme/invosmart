"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

import { AuthCard } from "@/components/auth/AuthCard";
import { FormError } from "@/components/auth/FormError";
import { FormSuccess } from "@/components/auth/FormSuccess";
import { LoginSchema, type LoginSchemaInput } from "@/lib/schemas";

const errorMap: Record<string, string> = {
  CredentialsSignin: "Email atau password salah.",
  OAuthAccountNotLinked: "Email sudah terdaftar dengan metode berbeda.",
};

type FieldErrors = Partial<Record<keyof LoginSchemaInput, string>>;

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOAuthLoading, setIsOAuthLoading] = useState(false);

  const callbackUrlParam = searchParams?.get("callbackUrl") ?? undefined;
  const registeredParam = searchParams?.get("registered") ?? undefined;
  const errorParam = searchParams?.get("error") ?? undefined;

  const safeCallbackUrl = useMemo(() => {
    if (callbackUrlParam && callbackUrlParam.startsWith("/")) {
      return callbackUrlParam;
    }

    return "/app";
  }, [callbackUrlParam]);

  const queryErrorMessage = useMemo(() => {
    if (!errorParam) {
      return null;
    }

    return errorMap[errorParam] ?? "Gagal masuk. Silakan coba lagi.";
  }, [errorParam]);

  const registrationSuccessMessage = useMemo(() => {
    if (registeredParam === "1") {
      return "Registrasi berhasil. Silakan masuk dengan kredensial Anda.";
    }

    return null;
  }, [registeredParam]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const rawValues: LoginSchemaInput = {
      email: typeof formData.get("email") === "string" ? (formData.get("email") as string) : "",
      password:
        typeof formData.get("password") === "string" ? (formData.get("password") as string) : "",
    };

    const parsed = LoginSchema.safeParse(rawValues);

    if (!parsed.success) {
      const { fieldErrors: parsedErrors } = parsed.error.flatten();

      setFieldErrors({
        email: parsedErrors.email?.[0],
        password: parsedErrors.password?.[0],
      });
      setFormError("Periksa kembali data yang Anda masukkan.");
      setIsSubmitting(false);
      return;
    }

    try {
      const result = await signIn("credentials", {
        ...parsed.data,
        redirect: false,
        callbackUrl: safeCallbackUrl,
      });

      if (!result?.ok) {
        setFormError(errorMap[result?.error ?? "CredentialsSignin"] ?? "Email atau password salah.");
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);
      router.push(result.url ?? safeCallbackUrl);
      router.refresh();
    } catch {
      setFormError("Terjadi kesalahan saat masuk. Silakan coba lagi.");
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsOAuthLoading(true);
    setFormError(null);

    try {
      await signIn("google", { callbackUrl: safeCallbackUrl });
      setIsOAuthLoading(false);
    } catch {
      setFormError("Gagal menghubungkan akun Google. Silakan coba lagi.");
      setIsOAuthLoading(false);
    }
  };

  const effectiveError = formError ?? queryErrorMessage;

  return (
    <AuthCard
      title="Masuk ke Invosmart"
      subtitle={
        <span>
          Belum punya akun? {" "}
          <Link href="/auth/register" className="text-primary underline-offset-4 hover:underline">
            Daftar sekarang
          </Link>
          .
        </span>
      }
    >
      <div className="space-y-4">
        <FormSuccess message={effectiveError ? undefined : registrationSuccessMessage} />
        <FormError message={effectiveError} />
      </div>

      <form className="space-y-6" onSubmit={handleSubmit} noValidate>
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
            disabled={isSubmitting || isOAuthLoading}
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
            autoComplete="current-password"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? "password-error" : undefined}
            disabled={isSubmitting || isOAuthLoading}
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
          disabled={isSubmitting || isOAuthLoading}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? "Memproses..." : "Masuk"}
        </button>
      </form>

      <div className="space-y-4">
        <div className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase text-muted-foreground">
            <span className="bg-background px-2">atau</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-80"
          disabled={isSubmitting || isOAuthLoading}
          aria-busy={isOAuthLoading}
        >
          {isOAuthLoading ? "Menghubungkan..." : "Lanjutkan dengan Google"}
        </button>
      </div>
    </AuthCard>
  );
}
