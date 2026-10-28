import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
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
  icons: {
    icon: "/brand/logo-icon.svg",
    shortcut: "/brand/logo-icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
        {children}
      </body>
    </html>
  );
}
