import Link from "next/link";

const sections = [
  {
    title: "Eksperimen Konten",
    description: "Pantau varian hook, caption, CTA, dan schedule beserta metriknya.",
    href: "/app/admin/experiments",
  },
  {
    title: "AUTO Actions Log",
    description: "Audit trail autopublish, schedule update, dan revert.",
    href: "/app/admin/auto-actions",
  },
  {
    title: "Audit Logs System",
    description: "Audit trail aktivitas invoice, autentikasi user, dan AI auto-actions.",
    href: "/app/admin/audit-logs",
  },
  {
    title: "Uptime Monitoring",
    description: "Status kesehatan sistem, latensi 24 jam, dan riwayat ping endpoint.",
    href: "/app/admin/uptime",
  },
];

export default function AdminHomePage() {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
      {sections.map((section) => (
        <Link
          key={section.href}
          href={section.href}
          className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:border-white/30 hover:bg-white/10"
        >
          <h2 className="text-xl font-semibold text-white">{section.title}</h2>
          <p className="text-sm text-white/70">{section.description}</p>
          <span className="text-sm font-medium text-indigo-300">Buka dashboard →</span>
        </Link>
      ))}
    </div>
  );
}
