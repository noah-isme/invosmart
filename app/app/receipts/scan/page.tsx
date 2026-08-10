import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/server/auth";
import { ReceiptScannerWrapper } from "./ReceiptScannerWrapper";

export default async function ScanReceiptPage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/auth/login");
  }

  return (
    <div className="space-y-8 pb-12 p-6 max-w-5xl mx-auto">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-text">Pindai Struk dengan AI</h1>
        <p className="text-sm text-text/65">
          Unggah gambar atau gunakan kamera perangkat Anda untuk mengambil struk. AI kami akan mengekstrak informasi dan membuat draft invoice untuk Anda.
        </p>
      </div>

      <ReceiptScannerWrapper />
    </div>
  );
}
