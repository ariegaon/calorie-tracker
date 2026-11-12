import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import "./globals.css";

const heebo = Heebo({ subsets: ["hebrew", "latin"], variable: "--font-heebo", display: "swap" });

export const metadata: Metadata = {
  title: "מאזן קלורי",
  description: "מעקב אישי אחר תזונה, פעילות ומשקל",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#059669",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="min-h-dvh bg-slate-50 font-sans text-slate-900 antialiased">
        <AuthProvider>
          <div className="mx-auto min-h-dvh w-full max-w-md px-4 pb-10 pt-6">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
