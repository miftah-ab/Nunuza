import type { Metadata } from "next";
import Script from "next/script";
import { ReviewClient } from "./ReviewClient";

export const metadata: Metadata = {
  title: "Read your draft",
  robots: { index: false, follow: false },
};

export default async function TelegramReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <ReviewClient postId={id} />
    </>
  );
}
