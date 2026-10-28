import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface LogoProps {
  /** "horizontal" = icon + wordmark; "icon" = mark only */
  variant?: "horizontal" | "icon";
  /** "light" = dark ink on white; "dark" = white/muted on dark bg */
  theme?: "light" | "dark";
  className?: string;
  /** Height in pixels; width is derived from SVG aspect ratio */
  height?: number;
  /** Whether to wrap in an <a> link to / */
  asLink?: boolean;
}

export function Logo({
  variant = "horizontal",
  theme = "light",
  className,
  height = 32,
  asLink = true,
}: LogoProps) {
  const isHorizontal = variant === "horizontal";
  const src =
    isHorizontal
      ? theme === "dark"
        ? "/brand/logo-horizontal-dark.svg"
        : "/brand/logo-horizontal.svg"
      : "/brand/logo-icon.svg";

  const alt = isHorizontal ? "Nunuza" : "Nunuza icon";

  // Horizontal: viewBox 160×40 → ratio 4:1; height drives width
  // Icon: viewBox 32×32 → ratio 1:1
  const width = isHorizontal ? height * 4 : height;

  const img = (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={cn("select-none", className)}
      priority
    />
  );

  if (!asLink) return img;

  return (
    <Link
      href="/"
      aria-label="Nunuza — go to home"
      className="inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 rounded"
    >
      {img}
    </Link>
  );
}
