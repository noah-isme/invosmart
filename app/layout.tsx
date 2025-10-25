import type { Metadata } from "next";
import { Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

import { ThemeProvider } from "@/context/ThemeContext";
import { ToastProvider } from "@/context/ToastContext";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
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
    <html lang="id" suppressHydrationWarning>
      <body className={`${plusJakarta.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          <ToastProvider>
            <div className="relative min-h-screen bg-bg text-text transition-colors duration-200">{children}</div>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
