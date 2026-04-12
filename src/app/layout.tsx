import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Admin Wilrijk — Tuition Management",
  description: "Tuition fee management system for Beit Midrash Wilrijk",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
