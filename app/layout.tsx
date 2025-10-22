import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "InvoSmart | Smart Invoice Assistant",
    template: "%s | InvoSmart",
  },
  description:
    "InvoSmart membantu freelancer dan bisnis kecil membuat, mengelola, dan menganalisis invoice profesional secara otomatis dengan dukungan AI.",
  openGraph: {
    title: "InvoSmart | Smart Invoice Assistant",
    description:
      "Kelola invoice dengan cepat, profesional, dan berbasis insight AI di satu dashboard terintegrasi.",
    url: "https://invosmart.example.com",
    siteName: "InvoSmart",
    locale: "id_ID",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "InvoSmart | Smart Invoice Assistant",
    description:
      "Bangun proses invoice yang cerdas dengan generator AI, template profesional, dan analitik bisnis real-time.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-slate-950 text-slate-100 antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
