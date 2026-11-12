"use client";

import { useState } from "react";

const CARDS = [
  {
    front: "Nothing posts without you.",
    back: "Every draft waits for your approval. Edit the text and the approval resets, so what you approved is what goes out.",
  },
  {
    front: "One post a day, at most.",
    back: "Publishing is capped at one a day and seven in any rolling week. Some days the right post is no post.",
  },
  {
    front: "LinkedIn's official door only.",
    back: "Posts go out through LinkedIn's official connection. Nunuza doesn't scrape LinkedIn or ask for your password.",
  },
  {
    front: "Unsure means it asks.",
    back: "If LinkedIn doesn't confirm a post, Nunuza stops and asks you to check your profile. No guessing, no duplicates.",
  },
];

export function Guarantees() {
  const [flipped, setFlipped] = useState<number | null>(null);

  return (
    <section className="nz-section nz-trust" id="control">
      <div className="nz-wrap">
        <h2 className="nz-display nz-h2">
          Your name is on it.
          <br />
          You stay in charge.
        </h2>
        <p className="nz-lede">
          An agent that writes for you needs rules you can count on. These are Nunuza&apos;s.
        </p>

        <div className="nz-flips">
          {CARDS.map((card, i) => (
            <button
              key={card.front}
              type="button"
              className="nz-flip"
              style={{ "--k": i - 1.5 } as React.CSSProperties}
              aria-pressed={flipped === i}
              onClick={() => setFlipped(flipped === i ? null : i)}
            >
              <span className="nz-flip-in">
                <span className="nz-face nz-face-front">
                  <h3>{card.front}</h3>
                  <span className="nz-face-hint">Tap to read why</span>
                </span>
                <span className="nz-face nz-face-back">
                  <p>{card.back}</p>
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
