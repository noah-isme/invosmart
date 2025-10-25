import Link from "next/link";

type FooterProps = {
  version: string;
};

const footerLinks = [
  { href: "/app/about", label: "Tentang" },
  { href: "/app/help", label: "Bantuan" },
  { href: "https://github.com/invosmart", label: "GitHub", external: true },
];

export default function Footer({ version }: FooterProps) {
  return (
    <footer
      aria-label="Informasi aplikasi"
      className="relative z-10 border-t border-white/10 bg-black/20 px-4 py-6 text-sm text-text/70 backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.32em] text-text/45">InvoSmart</p>
          <p className="text-sm text-text/75">
            Platform invoice modern dengan insight AI yang elegan dan responsif.
          </p>
          <p className="text-xs text-text/50">Build {version}</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-4 text-sm">
          {footerLinks.map((link) =>
            link.external ? (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-text/80 transition hover:border-white/20 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                {link.label}
                <span aria-hidden className="text-xs text-text/60">
                  ↗
                </span>
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-text/80 transition hover:border-white/20 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                {link.label}
              </Link>
            ),
          )}
        </nav>
      </div>
    </footer>
  );
}
