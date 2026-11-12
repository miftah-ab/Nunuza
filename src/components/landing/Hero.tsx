"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, CalendarDays, Check, Linkedin, Send, Sparkles } from "lucide-react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

const WAVE = [6, 12, 8, 16, 10, 18, 7, 14, 9, 17, 11, 6, 13, 8, 15, 10];
const SLICES = Array.from({ length: 12 }, (_, i) => i + 1);
const LAST_STEP = 5;
// When each chat step appears after load, in milliseconds.
const STEP_AT = [800, 2000, 3400, 5000, 6200];

export function Hero({ startStep = 0 }: { startStep?: number }) {
  const reduced = usePrefersReducedMotion();
  const [playedStep, setPlayedStep] = useState(startStep);
  // Reduced motion shows the finished thread instead of playing it out.
  const step = reduced ? LAST_STEP : playedStep;
  const [approved, setApproved] = useState(false);
  const [tilt, setTilt] = useState<{ rx: number; ry: number } | null>(null);
  const heroRef = useRef<HTMLElement | null>(null);

  // The chat plays out once on load.
  useEffect(() => {
    if (reduced || startStep > 0) return;
    const timers = STEP_AT.map((delay, index) =>
      window.setTimeout(() => setPlayedStep(index + 1), delay)
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [reduced, startStep]);

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (reduced || event.pointerType === "touch") return;
    const box = heroRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    setTilt({ rx: 6 - y * 16, ry: -12 + x * 30 });
  };

  const rigStyle = tilt
    ? ({ "--rx": `${tilt.rx}deg`, "--ry": `${tilt.ry}deg` } as React.CSSProperties)
    : undefined;

  return (
    <section
      ref={heroRef}
      className="nz-hero"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setTilt(null)}
    >
      <div className="nz-wrap nz-hero-grid">
        <div className="nz-hero-copy">
          <h1 className="nz-display nz-h1">
            <span>Talk it out.</span>
            <span>Post it right.</span>
          </h1>
          <p className="nz-hero-sub">
            Nunuza is the content agent for your LinkedIn. Send it a rough thought on
            Telegram or the web. It drafts in your voice, you approve, and it publishes.
          </p>
          <div id="hero-cta" className="nz-hero-cta">
            <Link href="/login" className="nz-btn nz-btn-primary">
              Get started
            </Link>
            <a href="#how" className="nz-btn nz-btn-ghost">
              See how it works <ArrowDown size={18} aria-hidden="true" />
            </a>
          </div>
          <p className="nz-hero-note">Nothing posts until you approve it.</p>
        </div>

        <div className="nz-stage" aria-label="Example conversation with Nunuza">
          <div className="nz-float">
            <div className={`nz-rig${tilt || reduced ? "" : " is-idle"}`} style={rigStyle}>
              {SLICES.map((i) => (
                <i key={i} className="nz-slice" style={{ "--i": i } as React.CSSProperties} />
              ))}
              <div className="nz-phone">
                <div className="nz-screen">
                  <div className="nz-screen-top">
                    <span className="nz-avatar">
                      <Sparkles size={16} color="#fff" aria-hidden="true" />
                    </span>
                    <div>
                      <div className="nz-screen-name">Nunuza</div>
                      <div className="nz-screen-sub">Your content agent</div>
                    </div>
                    <span className="nz-example">Example</span>
                  </div>

                  <div className="nz-thread" aria-live="polite">
                    <div className={`nz-msg nz-msg-you${step >= 1 ? " is-in" : ""}`}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="nz-wave" aria-hidden="true">
                          {WAVE.map((h, i) => (
                            <i key={i} style={{ "--h": h } as React.CSSProperties} />
                          ))}
                        </span>
                        <span>Voice note 0:18</span>
                      </div>
                    </div>
                    <div className={`nz-msg nz-msg-bot${step >= 2 ? " is-in" : ""}`}>
                      Heard you. Your first five customers changed what you build. I&apos;ll draft it
                      in your voice.
                    </div>
                    <div className={`nz-draft${step >= 3 ? " is-in" : ""}`}>
                      <div className="nz-draft-tag">
                        <Linkedin size={13} aria-hidden="true" /> LinkedIn draft
                      </div>
                      <p>Five customers changed our roadmap more than a quarter of planning did.</p>
                      <p>I stopped guessing what hurt. I asked.</p>
                    </div>
                    <div className={`nz-msg nz-msg-you${step >= 4 ? " is-in" : ""}`}>
                      Shorter opening.
                    </div>
                    <div className={`nz-msg nz-msg-bot${step >= 5 ? " is-in" : ""}`}>
                      Done. Nothing goes out until you approve.
                      <br />
                      <button
                        type="button"
                        className={`nz-approve${approved ? " is-done" : ""}`}
                        onClick={() => setApproved(true)}
                        disabled={approved || step < 5}
                      >
                        <Check size={14} aria-hidden="true" />
                        {approved ? "Approved" : "Approve"}
                      </button>
                    </div>
                  </div>

                  <div className="nz-composer">
                    <span>Message Nunuza</span>
                    <b>
                      <Send size={14} aria-hidden="true" />
                    </b>
                  </div>
                </div>
              </div>

              <div className="nz-fcard nz-fcard-a" aria-hidden="true">
                <Linkedin size={18} />
                <small>Draft ready for your review</small>
                <div className="nz-skel">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
              <div className="nz-fcard nz-fcard-b" aria-hidden="true">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <CalendarDays size={16} /> This week
                </span>
                <div className="nz-week">
                  <i />
                  <i className="on" />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
              <div className={`nz-fcard nz-fchip${approved ? " is-ok" : ""}`}>
                <Check size={16} aria-hidden="true" />
                {approved ? "Approved by you" : "Needs your OK"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
