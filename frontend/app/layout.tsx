import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FastShare — Reliable UDP Transport Architecture",
  description:
    "FastShare: High-performance reliable file transfer protocol over UDP sockets featuring Stop-and-Wait ARQ, CRC-32 integrity, packet segmentation, and fault injection.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <body className="min-h-screen pleasant-pattern text-slate-800 antialiased selection:bg-teal-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}