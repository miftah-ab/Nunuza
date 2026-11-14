import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { EarlyAccessForm } from "@/components/landing/EarlyAccessForm";
import "@/components/landing/early-access.css";

export const metadata: Metadata = {
  title: "Early access",
  description: "Get early access to Nunuza, the LinkedIn workflow assistant for professionals. It reads the news in your field, drafts posts in your voice, and waits for your approval before anything is published.",
  robots: { index: true, follow: true },
};

function Tick() {
  return (
    <svg className="nze-tickmark" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function EarlyAccessPage() {
  return (
    <main className="nz nze">
      <header className="nze-nav">
        <div className="nze-wrap nze-nav-in">
          <Logo height={28} />
          <p className="nze-have">Already have an account? <Link href="/login">Sign in</Link></p>
        </div>
      </header>

      <div className="nze-wrap nze-main">
        <section className="nze-copy" aria-labelledby="nze-title">
          <p className="nze-pill"><span aria-hidden="true" />Early access</p>
          <h1 id="nze-title" className="nz-display nze-title"><span className="nze-line">Nunuza finds the story.</span> <span className="nze-line">You approve the post.</span></h1>
          <p className="nze-lede">
            Every day, Nunuza reads the news in your field, picks what is worth saying, and sends a draft in your
            voice to Telegram. You approve before anything is published.
          </p>
          <EarlyAccessForm />
        </section>

        <aside className="nze-flow" aria-labelledby="nze-flow-title">
          <h2 id="nze-flow-title" className="nze-flow-title">What Nunuza does for you</h2>
          <ol className="nze-steps">
            <li className="nze-step" style={{ "--i": 0 } as React.CSSProperties}>
              <span className="nze-node" aria-hidden="true"><Tick /></span>
              <div>
                <h3>Watches your field</h3>
                <p>Reads recent news every day and matches it to your audience and strategy.</p>
              </div>
            </li>
            <li className="nze-step" style={{ "--i": 1 } as React.CSSProperties}>
              <span className="nze-node" aria-hidden="true"><Tick /></span>
              <div>
                <h3>Picks what is worth saying</h3>
                <p>Skips topics you ruled out and stories it already covered. No good story today? It waits.</p>
              </div>
            </li>
            <li className="nze-step" style={{ "--i": 2 } as React.CSSProperties}>
              <span className="nze-node" aria-hidden="true"><Tick /></span>
              <div>
                <h3>Drafts it in your voice</h3>
                <p>Written from your voice profile and content strategy, not a template.</p>
              </div>
            </li>
            <li className="nze-step nze-step-wait" style={{ "--i": 3 } as React.CSSProperties}>
              <span className="nze-node nze-node-wait" aria-hidden="true" />
              <div>
                <h3>Asks you on Telegram</h3>
                <p>The draft is waiting for your decision.</p>
                <div className="nze-draft">
                  <b>Most onboarding checklists fail for one reason.</b>
                  <span>Nobody asks what the new person already knows. I start with a single question&hellip;</span>
                </div>
                <div className="nze-actions" aria-hidden="true">
                  <span className="nze-approve">Approve</span>
                  <span className="nze-ghost">Edit</span>
                  <span className="nze-ghost">Skip</span>
                </div>
              </div>
            </li>
          </ol>
          <p className="nze-own">Have your own idea? Send a voice note or a few words and Nunuza drafts that instead.</p>
          <p className="nze-auto"><b>Autopilot</b> is optional. When you are ready, you can let Nunuza publish within limits you set.</p>
        </aside>
      </div>

      <section className="nze-trust" aria-label="How Nunuza keeps you in control">
        <ul className="nze-wrap nze-trust-in">
          <li><Tick /><span><b>Nothing posts without you.</b> Edit a draft and the approval resets.</span></li>
          <li><Tick /><span><b>One post a day, at most.</b> Some days the right post is no post.</span></li>
          <li><Tick /><span><b>LinkedIn&rsquo;s official connection only.</b> No scraping, no password.</span></li>
        </ul>
      </section>

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
