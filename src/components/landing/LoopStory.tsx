"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Linkedin, Mic } from "lucide-react";

const BARS = [18, 44, 26, 62, 34, 78, 22, 56, 40, 70, 28, 48, 20, 64, 36, 52, 24, 60, 30, 42];

function SceneVoice({ live }: { live: boolean }) {
  return (
    <div className={`nz-scene${live ? " is-live" : ""}`}>
      <div className="nz-scene-bar">
        <Mic size={16} aria-hidden="true" /> Telegram or web
      </div>
      <div className="nz-bigwave" aria-hidden="true">
        {BARS.map((h, i) => (
          <i key={i} style={{ "--h": h, "--d": i * 55 } as React.CSSProperties} />
        ))}
      </div>
      <p className="nz-quote">
        &ldquo;We shipped late, and the delay taught us what customers actually wait for.&rdquo;
      </p>
      <p className="nz-note">A voice note or a typed line. Rough is fine.</p>
    </div>
  );
}

function SceneDraft() {
  return (
    <div className="nz-scene">
      <div className="nz-scene-bar">
        <Linkedin size={16} aria-hidden="true" /> LinkedIn draft
      </div>
      <div className="nz-post">
        <div className="nz-post-head">
          <span className="nz-post-av" />
          <div className="nz-post-who">
            You
            <small>Draft</small>
          </div>
        </div>
        <p>We shipped two weeks late. It was the best thing that happened to the product.</p>
        <p>The delay forced us to ask customers what they were really waiting for.</p>
      </div>
      <div className="nz-tags">
        <span className="nz-pill nz-pill-forest">
          <Check size={13} aria-hidden="true" /> Your voice profile
        </span>
        <span className="nz-pill">Your strategy</span>
        <span className="nz-pill">Topics you excluded stay out</span>
      </div>
    </div>
  );
}

function SceneApprove() {
  return (
    <div className="nz-scene">
      <div className="nz-scene-bar">Waiting for you</div>
      <div className="nz-post">
        <p>We shipped two weeks late. It was the best thing that happened to the product.</p>
      </div>
      <div className="nz-actions">
        <span className="nz-act nz-act-go">Approve</span>
        <span className="nz-act">Edit</span>
        <span className="nz-act">Skip</span>
      </div>
      <p className="nz-note">Change a single word and the approval resets. You approve what goes out.</p>
    </div>
  );
}

function SceneCalendar({ live }: { live: boolean }) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  return (
    <div className={`nz-scene${live ? " is-live" : ""}`}>
      <div className="nz-scene-bar">Your publishing calendar</div>
      <div className="nz-cal" aria-hidden="true">
        {days.map((d) => (
          <div key={d} className="nz-cal-d">
            {d}
          </div>
        ))}
        {days.map((d) => (
          <div key={`${d}-c`} className={`nz-cal-c${d === "Wed" ? " is-post" : ""}`} />
        ))}
      </div>
      <p className="nz-note">One post a day at most, and seven in any rolling week.</p>
    </div>
  );
}

function ScenePublished() {
  return (
    <div className="nz-scene">
      <div className="nz-scene-bar">
        <Linkedin size={16} aria-hidden="true" /> Through LinkedIn&apos;s official connection
      </div>
      <div className="nz-post">
        <div className="nz-post-head">
          <span className="nz-post-av" />
          <div className="nz-post-who">
            You
            <small>Published</small>
          </div>
          <span className="nz-pill nz-pill-forest" style={{ marginLeft: "auto" }}>
            <Check size={13} aria-hidden="true" /> Live
          </span>
        </div>
        <p>We shipped two weeks late. It was the best thing that happened to the product.</p>
      </div>
      <p className="nz-note">
        If LinkedIn doesn&apos;t confirm a post, Nunuza asks you to check your profile. It never guesses and
        never posts twice.
      </p>
    </div>
  );
}

const STEPS = [
  {
    title: "Say it the way it comes",
    body: "Send a voice note or a few typed words, on Telegram or in the app. You don't need a finished thought.",
    scene: (live: boolean) => <SceneVoice live={live} />,
  },
  {
    title: "It writes like you",
    body: "Nunuza drafts from your voice profile and your content strategy, and keeps away from the topics you ruled out.",
    scene: () => <SceneDraft />,
  },
  {
    title: "You decide",
    body: "Approve it, edit it, or skip it. Nothing moves forward without your yes.",
    scene: () => <SceneApprove />,
  },
  {
    title: "It takes a slot on your calendar",
    body: "Approved posts get a time. Publishing is capped, so your profile never turns into a firehose.",
    scene: (live: boolean) => <SceneCalendar live={live} />,
  },
  {
    title: "It goes out through LinkedIn",
    body: "Posts publish through LinkedIn's official connection. When the result is unclear, you confirm it.",
    scene: () => <ScenePublished />,
  },
];

export function LoopStory({ initialActive = 0 }: { initialActive?: number }) {
  const [active, setActive] = useState(initialActive);
  const refs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const nodes = refs.current.filter((n): n is HTMLElement => n !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (!Number.isNaN(index)) setActive(index);
          }
        }
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="how" className="nz-section">
      <div className="nz-wrap">
        <h2 className="nz-display nz-h2">
          From a rough thought
          <br />
          to a live post.
        </h2>
        <p className="nz-lede">
          One loop, and you are in it at the only step that matters: the decision.
        </p>

        <div className="nz-loop-grid">
          <div>
            {STEPS.map((s, i) => (
              <article
                key={s.title}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                data-index={i}
                className={`nz-step${active === i ? " is-active" : ""}`}
              >
                <span className="nz-step-n">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <div className="nz-step-scene">{s.scene(true)}</div>
              </article>
            ))}
          </div>

          <div className="nz-loop-stage" aria-hidden="true">
            {STEPS.map((s, i) => (
              <div key={s.title} className={`nz-scene-slot${active === i ? " is-active" : ""}`}>
                {s.scene(active === i)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
