import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const requestSchema = z.object({
  name: z.string().trim().max(80).optional().default(""),
  email: z.string().trim().email().max(254),
  linkedinUrl: z.string().trim().max(500).optional().default(""),
  challenge: z.string().trim().max(80).optional().default(""),
  website: z.string().max(200).optional().default(""),
});

const genericSuccess = { success: true };

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a valid email address and try again." }, { status: 400 });
    }

    const { name, email, linkedinUrl, challenge, website } = parsed.data;
    // Honeypot: silently accept bot submissions without storing them.
    if (website) return NextResponse.json(genericSuccess);

    if (linkedinUrl) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(linkedinUrl);
      } catch {
        return NextResponse.json({ error: "Enter a valid LinkedIn profile URL." }, { status: 400 });
      }
      if (!["linkedin.com", "www.linkedin.com"].includes(parsedUrl.hostname) || !parsedUrl.pathname.startsWith("/in/")) {
        return NextResponse.json({ error: "Use your public LinkedIn profile URL (linkedin.com/in/…)."} , { status: 400 });
      }
    }

    const supabase = createServiceClient();
    const { error } = await supabase.from("early_access_signups").insert({
      name: name || null,
      email: email.toLowerCase(),
      linkedin_url: linkedinUrl || null,
      challenge: challenge || null,
      source: "website",
    });

    if (error && error.code !== "23505") {
      console.error("[early-access] signup insert failed:", error.code);
      return NextResponse.json({ error: "We couldn’t save your request right now. Please try again shortly." }, { status: 500 });
    }

    return NextResponse.json(genericSuccess);
  } catch (error) {
    console.error("[early-access] request failed:", error);
    return NextResponse.json({ error: "We couldn’t save your request right now. Please try again shortly." }, { status: 500 });
  }
}
