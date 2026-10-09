/**
 * The Asia/Jakarta calendar date (YYYY-MM-DD) of an instant: the date the
 * invoice export writes (lib/export-utils.ts formatDateForExport).
 */
export const jakartaDate = (instant: string | Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(instant),
  );
