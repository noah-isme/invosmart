const rawVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "v1.0.0";

const normalizedVersion = rawVersion.startsWith("v") ? rawVersion : `v${rawVersion}`;

export const APP_VERSION = normalizedVersion;
export const BUILD_DATE_ISO = process.env.NEXT_PUBLIC_BUILD_DATE ?? new Date().toISOString();
export const COMMIT_HASH = process.env.NEXT_PUBLIC_COMMIT_SHA ?? "local";

export const RELEASE_TAG = `invo-smart@${APP_VERSION}`;

export const CHANGELOG_PATH = "/CHANGELOG.md";

export function getReadableBuildDate(locale = "id-ID") {
  try {
    const date = new Date(BUILD_DATE_ISO);
    if (Number.isNaN(date.getTime())) {
      return BUILD_DATE_ISO;
    }

    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return BUILD_DATE_ISO;
  }
}

export function getCommitHashShort(length = 7) {
  if (!COMMIT_HASH) {
    return "unknown";
  }

  return COMMIT_HASH.slice(0, Math.max(length, 1));
}
