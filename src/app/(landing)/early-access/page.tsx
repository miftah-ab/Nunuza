import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { EarlyAccessForm } from "@/components/landing/EarlyAccessForm";
import "@/components/landing/early-access.css";

export const metadata: Metadata = {
  title: "Early access",
  description: "Get early access to Nunuza, the LinkedIn workflow assistant for professionals who want to create, review, schedule, and publish content more consistently.",
  robots: { index: true, follow: true },
};

export default function EarlyAccessPage() {
  return (
    <main className="nz nze">
      <header className="nze-nav">
        <div className="nze-wrap nze-nav-in">
          <Logo height={28} />
          <Link href="/login" className="nze-signin">Sign in</Link>
        </div>
      </header>

      <div className="nze-wrap nze-main">
        <section className="nze-copy" aria-labelledby="nze-title">
          <p className="nze-pill"><span aria-hidden="true" />Early access</p>
          <h1 id="nze-title" className="nz-display nze-title">Your best posts are already in your head.</h1>
          <p className="nze-lede">
            For professionals, creators, consultants, recruiters, and business owners who want a more consistent LinkedIn presence. Send an idea by message or voice note. Nunuza turns it into a draft in your voice, and you approve every post before it goes out.
          </p>
          <EarlyAccessForm />
        </section>

        <aside className="nze-flow" aria-labelledby="nze-flow-title">
          <h2 id="nze-flow-title" className="nze-flow-title">How it works</h2>
          <ol className="nze-steps">
            <li className="nze-step">
              <span className="nze-node" aria-hidden="true">1</span>
              <div>
                <h3>You send an idea</h3>
                <p>Text or voice. Rough is fine.</p>
                <div className="nze-bubble">Why most onboarding checklists get ignored, and what I do instead.</div>
              </div>
            </li>
            <li className="nze-step">
              <span className="nze-node" aria-hidden="true">2</span>
              <div>
                <h3>Nunuza drafts it in your voice</h3>
                <p>A post that reads like you wrote it.</p>
                <div className="nze-draft">
                  <b>Most onboarding checklists fail for one reason.</b>
                  <span>Nobody asks what the new person already knows. I start with a single question&hellip;</span>
                </div>
              </div>
            </li>
            <li className="nze-step">
              <span className="nze-node" aria-hidden="true">3</span>
              <div>
                <h3>You approve it</h3>
                <p>Nothing is published without your yes.</p>
                <span className="nze-approve">Approve</span>
              </div>
            </li>
          </ol>
          <p className="nze-example">Example only. Your drafts come from your own ideas.</p>
        </aside>
      </div>

      <footer className="nze-footer">
        <div className="nze-wrap nze-footer-in">
          <span>&copy; {new Date().getFullYear()} Nunuza</span>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </div>
      </footer>
    </main>
  );
}
