import Link from "next/link";

export function LandingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="nz-foot">
      <div className="nz-wrap nz-foot-in">
        <span>© {year} Nunuza</span>
        <div className="nz-foot-links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </div>
      </div>
    </footer>
  );
}
