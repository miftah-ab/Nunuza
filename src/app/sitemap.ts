import type { MetadataRoute } from "next";

const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/pricing", "/privacy", "/terms", "/login"].map((path) => ({
    url: baseUrl + path,
    changeFrequency: path === "/" ? "weekly" : "monthly",
  }));
}
