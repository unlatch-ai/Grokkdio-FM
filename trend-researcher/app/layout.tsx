import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trend Researcher",
  description: "Trend research backend service",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
