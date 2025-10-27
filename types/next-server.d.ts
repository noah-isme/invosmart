declare module "next/server" {
  // Minimal approximations so tsc can type-check API route usages in this repo.
  // These are intentionally small and only cover what's used in the codebase.

  export interface NextUrlLike {
    pathname?: string;
    searchParams?: URLSearchParams;
  }

  export type NextRequest = Request & {
    nextUrl?: NextUrlLike;
  };

  export const NextResponse: {
    json(body: unknown, init?: ResponseInit): Response;
    redirect(url: string | URL, init?: ResponseInit): Response;
    rewrite(url: string | URL): Response;
    next(): Response;
    error(): Response;
    // allow constructing new NextResponse if used
    new (body?: BodyInit | null, init?: ResponseInit): Response;
  };

  export {};
}
