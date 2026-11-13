"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Phone-only bottom bar. It appears once the hero buttons have scrolled away and
 * hides again while the closing call to action is on screen, so two buttons are
 * never visible at once.
 */
export function StickyCta() {
  const [heroVisible, setHeroVisible] = useState(true);
  const [endVisible, setEndVisible] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("hero-cta");
    const end = document.getElementById("final-cta");
    if (!hero || !end) return;

    const heroObserver = new IntersectionObserver(([entry]) => {
      if (entry) setHeroVisible(entry.isIntersecting);
    });
    const endObserver = new IntersectionObserver(([entry]) => {
      if (entry) setEndVisible(entry.isIntersecting);
    });
    heroObserver.observe(hero);
    endObserver.observe(end);
    return () => {
      heroObserver.disconnect();
      endObserver.disconnect();
    };
  }, []);

  const show = !heroVisible && !endVisible;

  return (
    <div className={`nz-sticky-cta${show ? " is-show" : ""}`} aria-hidden={!show}>
      <span className="nz-sticky-note">You approve every post.</span>
      <Link href="/login" className="nz-btn nz-btn-primary nz-btn-sm" tabIndex={show ? 0 : -1}>
        Get started
      </Link>
    </div>
  );
}
