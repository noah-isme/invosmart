import type { Metadata } from "next";
import { Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

import Footer from "@/components/layout/Footer";
import { Banner } from "@/components/layout/Banner";
import ClientRoot from "@/components/ClientRoot";
import { APP_VERSION } from "@/lib/release";

import { PWARegister } from "@/components/PWARegister";

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
    default: "InvoSmart – Smart AI Invoice & Insight Platform",
    template: "%s | InvoSmart",
  },
  description:
    "Kelola invoice, tema, dan insight finansial secara otomatis dengan kecerdasan buatan.",
  openGraph: {
    title: "InvoSmart – Smart AI Invoice & Insight Platform",
    description:
      "Kelola invoice, tema, dan insight finansial secara otomatis dengan kecerdasan buatan.",
    url: "https://invosmart.example.com",
    siteName: "InvoSmart",
    locale: "id_ID",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "InvoSmart – Smart AI Invoice & Insight Platform",
    description:
      "Kelola invoice, tema, dan insight finansial secara otomatis dengan kecerdasan buatan.",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
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
        <PWARegister />
        <ClientRoot>
          <div className="relative flex min-h-screen flex-col bg-bg text-text transition-colors duration-200">
            <Banner text={`🎉 InvoSmart ${APP_VERSION} is live! Thanks for supporting our launch.`} />
            <div className="flex-1 pb-24">{children}</div>
            <Footer version={APP_VERSION} />
          </div>
        </ClientRoot>
      </body>
    </html>
  );
}
