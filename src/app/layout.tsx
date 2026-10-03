import type { Metadata } from "next";
import { dataMode } from "@/server/mode";
import { Shell } from "@/components/shell";
import localFont from "next/font/local";
import "./globals.css";
import "./design-system.css";
const display = localFont({
  src: "./fonts/newsreader.woff2",
  variable: "--font-editorial",
  display: "swap",
  weight: "200 800",
});
const sans = localFont({
  src: "./fonts/manrope.woff2",
  variable: "--font-ui",
  display: "swap",
  weight: "200 800",
});
const mono = localFont({
  src: "./fonts/plex-mono.woff2",
  variable: "--font-code",
  display: "swap",
  weight: "400",
  preload: false,
});
export const metadata: Metadata = {
  title: "BrainOS — Daniel’s Newsroom",
  description: "A human-led editorial newsroom for applied AI.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "BrainOS", statusBarStyle: "default" },
  icons: { apple: "/app-icon.png" },
};
export const dynamic = "force-dynamic";
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <Shell demo={dataMode() === "demo"}>{children}</Shell>
      </body>
    </html>
  );
}
