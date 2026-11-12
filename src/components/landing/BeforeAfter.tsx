"use client";

import { useState } from "react";

export function BeforeAfter({ initial = 50 }: { initial?: number }) {
  const [pos, setPos] = useState(initial);

  return (
    <section className="nz-section" id="difference">
      <div className="nz-wrap">
        <h2 className="nz-display nz-h2">
          The Sunday scramble,
          <br />
          gone.
        </h2>
        <p className="nz-lede">Drag to compare a week without Nunuza and a week with it.</p>

        <div className="nz-compare-box" style={{ "--pos": `${pos}%` } as React.CSSProperties}>
          <div className="nz-pane nz-pane-without">
            <h3>Without Nunuza</h3>
            <div className="nz-note-stack">
              <div className="nz-sticky" style={{ "--r": "-3deg" } as React.CSSProperties}>
                Post about the customer call. Write it later.
              </div>
              <div className="nz-sticky is-gray" style={{ "--r": "2deg" } as React.CSSProperties}>
                Blank doc. Cursor blinking.
              </div>
              <div className="nz-sticky" style={{ "--r": "4deg" } as React.CSSProperties}>
                What did I post last time?
              </div>
            </div>
          </div>

          <div className="nz-pane nz-pane-with">
            <h3>With Nunuza</h3>
            <div className="nz-queue">
              <div className="nz-qrow">
                Customer call lesson
                <b>Needs your OK</b>
              </div>
              <div className="nz-qrow">
                Why we cut a feature
                <b className="is-ok">Scheduled</b>
              </div>
              <div className="nz-qrow">
                Hiring note
                <b className="is-ok">Published</b>
              </div>
            </div>
          </div>

          <div className="nz-handle" aria-hidden="true" />
          <input
            className="nz-range"
            type="range"
            min={8}
            max={92}
            value={pos}
            aria-label="Compare without Nunuza and with Nunuza"
            onChange={(e) => setPos(Number(e.target.value))}
          />
        </div>
      </div>
    </section>
  );
}
