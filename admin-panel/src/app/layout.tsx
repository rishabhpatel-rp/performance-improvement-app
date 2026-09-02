import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Performance App Admin",
  description: "Admin panel for the Performance Improvement Shopify app",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
