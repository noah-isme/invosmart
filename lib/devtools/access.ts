import type { Session } from "next-auth";

const getAdminEmails = () => {
  const envValue = process.env.ADMIN_EMAILS ?? process.env.NEXT_PUBLIC_ADMIN_EMAILS;

  if (!envValue) return [] as string[];

  return envValue
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
};

export const canViewPerfTools = (session: Session | null | undefined) => {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  const email = session?.user?.email?.toLowerCase();
  if (!email) return false;

  const adminEmails = getAdminEmails();

  return adminEmails.includes(email);
};

export const getPerfToolsSampleRate = () => {
  const value = process.env.NEXT_PUBLIC_RUM_SAMPLE_RATE ?? "0.2";
  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    return 0.2;
  }

  if (parsed <= 0) return 0;
  if (parsed >= 1) return 1;

  return parsed;
};

