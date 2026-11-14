import type { Metadata } from "next";
import Link from "next/link";
import { Hero } from "@/components/landing/Hero";
import { LoopStory } from "@/components/landing/LoopStory";
import { VoiceDemo } from "@/components/landing/VoiceDemo";
import { Guarantees } from "@/components/landing/Guarantees";
import { BeforeAfter } from "@/components/landing/BeforeAfter";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { StickyCta } from "@/components/landing/StickyCta";
import EarlyAccessPage from "./early-access/page";

/**
 * Keep the public entry point aligned with the signup state.
 * During private testing, visitors land directly on the early-access page.
 * Once public signup is enabled, the normal product landing page returns.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Nunuza: Automate your LinkedIn workflow.",
  description:
    "Nunuza helps professionals build a consistent LinkedIn presence. Turn ideas into on-brand drafts, review them, schedule posts, and publish with your approval.",
  openGraph: {
    title: "Nunuza: Automate your LinkedIn workflow.",
    description:
      "Automate your LinkedIn content workflow with AI-assisted drafting, review, scheduling, and approval-first publishing through LinkedIn's official connection.",
    type: "website",
  },
};

export default function LandingPage() {
  if (process.env.PUBLIC_SIGNUP_ENABLED !== "true") {
    return <EarlyAccessPage />;
  }

  return (
    <>
      <LandingNav />
      <main id="main-content">
        <Hero />
        <LoopStory />
        <VoiceDemo />
        <Guarantees />
        <BeforeAfter />
        <section id="final-cta" className="nz-final">
          <div className="nz-wrap">
            <h2 className="nz-display">
              Your next post
              <br />
              starts with one message.
            </h2>
            <p className="nz-final-sub">
              Connect Google, link LinkedIn, and send your first thought. You approve every post.
            </p>
            <Link href="/login" className="nz-btn nz-btn-primary">
              Get started
            </Link>
          </div>
        </section>
      </main>
      <LandingFooter />
      <StickyCta />
    </>
  );
}
