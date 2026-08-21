import type { Metadata } from "next";
import { Syne, Manrope, JetBrains_Mono } from "next/font/google";
import { ClientNav } from "@/components/ClientNav";
import "./app.css";

const display = Syne({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const body = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "TorBox Downloader",
  description: "Search via Comet, download with TorBox, rename files cleanly.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body>
        <div className="app-frame">
          <ClientNav />
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
