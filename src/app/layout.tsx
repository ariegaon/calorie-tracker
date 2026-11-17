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
  // Lets the page know the size of the iPhone status bar / home indicator (env(safe-area-inset-*)).
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="min-h-dvh bg-slate-50 font-sans text-slate-900 antialiased">
        <AuthProvider>
          <div className="mx-auto min-h-dvh w-full max-w-md px-4 pb-10 pt-[calc(env(safe-area-inset-top)+1.5rem)]">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
