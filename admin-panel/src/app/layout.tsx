import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Performance App Admin",
  description: "Admin panel for the Performance Improvement Shopify app",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Extensions may inject body attrs (e.g. cz-shortcut-listen) before React hydrates.
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
