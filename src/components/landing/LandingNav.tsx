import Link from "next/link";
import { Logo } from "@/components/layout/Logo";

export function LandingNav() {
  return (
    <header className="nz-nav">
      <div className="nz-wrap nz-nav-in">
        <Logo height={29} />
        <nav className="nz-nav-links" aria-label="Main">
          <a href="#how" className="nz-nav-link">
            How it works
          </a>
          <Link href="/login" className="nz-nav-link">
            Log in
          </Link>
          <Link href="/login" className="nz-btn nz-btn-primary nz-btn-sm">
            Early access
          </Link>
        </nav>
      </div>
    </header>
  );
}
