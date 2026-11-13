import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { EarlyAccessForm } from "@/components/landing/EarlyAccessForm";

export const metadata: Metadata = {
  title: "Early access",
  description: "Get an early look at Nunuza, the LinkedIn content agent built around your voice and your approval.",
  robots: { index: true, follow: true },
};

export default function EarlyAccessPage() {
  return (
    <main className="nz nz-early">
      <header className="nz-early-nav">
        <div className="nz-wrap nz-early-nav-in">
          <Logo height={29} />
          <Link href="/login" className="nz-early-back">Already have an account? Sign in</Link>
        </div>
      </header>

      <section className="nz-early-main">
        <div className="nz-early-copy">
          <div className="nz-early-eyebrow"><span className="nz-early-pulse" /> EARLY ACCESS PROGRAM</div>
          <h1 className="nz-display nz-early-title">Make LinkedIn<br /><span>feel less like work.</span></h1>
          <p className="nz-early-lede">
            Turn rough thoughts into thoughtful LinkedIn posts without starting from a blank page.
            Nunuza helps shape the draft in your voice. You stay in control of what goes out.
          </p>

          <div className="nz-early-points">
            <div><span><CheckCircle2 size={17} /></span><p><b>Start with a thought</b><small>Send a message or voice note. No perfect prompt needed.</small></p></div>
            <div><span><CheckCircle2 size={17} /></span><p><b>Keep your voice</b><small>Build a workflow around your point of view, not generic content.</small></p></div>
            <div><span><CheckCircle2 size={17} /></span><p><b>You approve every post</b><small>No surprise publishing. You decide what is ready.</small></p></div>
          </div>

          <div className="nz-early-note">
            <ShieldCheck size={17} />
            <span>Joining is free. No credit card. No obligation to use the product.</span>
          </div>
        </div>

        <aside className="nz-early-card">
          <div className="nz-early-card-top">
            <div className="nz-early-icon"><Sparkles size={19} /></div>
            <div><b>Get early access</b><small>Tell us a little about your workflow.</small></div>
          </div>
          <EarlyAccessForm />
          <p className="nz-early-privacy">We’ll only use your details to contact you about Nunuza early access. No spam.</p>
        </aside>
      </section>

      <footer className="nz-early-footer">
        <span>© {new Date().getFullYear()} Nunuza</span>
        <span>Built for people with something worth saying.</span>
        <Link href="/privacy">Privacy</Link>
      </footer>
    </main>
  );
}
