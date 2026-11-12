"use client";

import { useState } from "react";

const THOUGHTS = [
  { id: "late", label: "We shipped late and learned why." },
  { id: "five", label: "Our first five customers changed the roadmap." },
  { id: "post", label: "I almost didn't post this." },
] as const;

const TONES = [
  { id: "direct", label: "Direct" },
  { id: "warm", label: "Warm" },
  { id: "analytical", label: "Analytical" },
] as const;

type ThoughtId = (typeof THOUGHTS)[number]["id"];
type ToneId = (typeof TONES)[number]["id"];

const DRAFTS: Record<ThoughtId, Record<ToneId, string[]>> = {
  late: {
    direct: [
      "We shipped two weeks late.",
      "Good. The delay made us ask customers what they were waiting for. We had been guessing.",
    ],
    warm: [
      "We missed our date, and I felt every day of it.",
      "But the delay gave us time to call the people we build for. Their answers changed the plan, and I'm grateful.",
    ],
    analytical: [
      "Shipping two weeks late exposed an assumption: we thought speed was the constraint.",
      "Customer calls showed the constraint was clarity. The slip bought us the data to see it.",
    ],
  },
  five: {
    direct: [
      "Five customer calls beat a quarter of planning.",
      "We dropped three roadmap items by Friday. Nobody had asked for them.",
    ],
    warm: [
      "I thought I knew where it hurt. Then I listened to five customers.",
      "They were kind and honest, and the roadmap looks different because of them.",
    ],
    analytical: [
      "Five customer calls contradicted three roadmap items.",
      "The pattern was consistent: people wanted fewer steps, not more features. We re-ranked the roadmap on that.",
    ],
  },
  post: {
    direct: [
      "I almost didn't post this.",
      "That is usually the sign it is worth posting. Here is what I was afraid to say.",
    ],
    warm: [
      "I almost kept this to myself.",
      "Then I remembered how much I learn when someone else shares the messy middle. So here is mine.",
    ],
    analytical: [
      "I nearly deleted this draft.",
      "My rule now: if I hesitate, I ask what the fear protects. Most of the time it protects my image, not my reader.",
    ],
  },
};

export function VoiceDemo() {
  const [thought, setThought] = useState<ThoughtId>("late");
  const [tone, setTone] = useState<ToneId>("direct");
  // Bumping the key restarts the swap animation each time the draft changes.
  const [swap, setSwap] = useState(0);

  const pick = (next: () => void) => {
    next();
    setSwap((n) => n + 1);
  };

  const paragraphs = DRAFTS[thought][tone];

  return (
    <section className="nz-section nz-demo-bg" id="voice">
      <div className="nz-wrap">
        <h2 className="nz-display nz-h2">
          Same thought.
          <br />
          Your tone.
        </h2>
        <p className="nz-lede">
          Pick a thought and a tone to see how a draft changes. In the app, drafts follow the voice
          profile you write yourself.
        </p>

        <div className="nz-demo-grid">
          <div className="nz-demo-controls">
            <div>
              <h3 className="nz-ctl-title">The thought</h3>
              <div className="nz-chips">
                {THOUGHTS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="nz-chip"
                    aria-pressed={thought === t.id}
                    onClick={() => pick(() => setThought(t.id))}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h3 className="nz-ctl-title">The tone</h3>
              <div className="nz-chips">
                {TONES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="nz-chip nz-chip-tone"
                    aria-pressed={tone === t.id}
                    onClick={() => pick(() => setTone(t.id))}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="nz-demo-out">
            <div className="nz-demo-card">
              <div className="nz-post-head">
                <span className="nz-post-av" />
                <div className="nz-post-who">
                  You
                  <small>Sample draft</small>
                </div>
              </div>
              <div key={swap} className={`nz-demo-text${swap > 0 ? " is-swap" : ""}`} aria-live="polite">
                {paragraphs.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
            </div>
            <p className="nz-fine">These are sample drafts written for this page, not live output.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
