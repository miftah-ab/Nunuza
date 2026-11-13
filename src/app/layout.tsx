import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { PwaRegistration } from "@/components/pwa/PwaRegistration";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ),
  title: {
    default: "Nunuza — LinkedIn content operations for founders",
    template: "%s | Nunuza",
  },
  description:
    "Nunuza turns your strategy, voice, and drafts into a reviewable LinkedIn content workflow. Draft, review, and export posts from one place.",
  keywords: [
    "LinkedIn content",
    "founder content strategy",
    "LinkedIn drafts",
    "content workflow",
    "LinkedIn assistant",
  ],
  authors: [{ name: "Nunuza" }],
  creator: "Nunuza",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Nunuza",
    title: "Nunuza — LinkedIn content operations for founders",
    description:
      "Draft, review, and export LinkedIn posts in a structured workflow. Strategy, voice, and drafts in one place.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Nunuza — LinkedIn content operations for founders",
    description:
      "Draft, review, and export LinkedIn posts in a structured workflow.",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Nunuza",
  },
  icons: {
    icon: [
      { url: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/brand/icon-192.png",
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#174C3C",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased bg-white text-ink">
        <PwaRegistration />
        <Analytics />
        {children}
      </body>
    </html>
  );
}
