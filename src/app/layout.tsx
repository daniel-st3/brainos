import type { Metadata } from "next";
import { Shell } from "@/components/shell";
import "./globals.css";
export const metadata: Metadata = {
  title: "Content OS — Daniel’s Newsroom",
  description: "A human-led editorial newsroom for applied AI.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <Shell demo={process.env.CONTENT_OS_MODE !== "supabase"}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
