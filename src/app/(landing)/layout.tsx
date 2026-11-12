import { Bricolage_Grotesque } from "next/font/google";
import "@/components/landing/landing.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

/** The landing page brings its own nav and footer, so it sits outside the shared marketing shell. */
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <div className={`nz ${display.variable}`}>{children}</div>;
}
