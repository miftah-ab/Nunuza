import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/workspace";
import { PolarService } from "@/lib/integrations/polar/service";
import { BillingClient } from "./BillingClient";

export const metadata: Metadata = {
  title: "Billing & Subscription — Nunuza",
  robots: { index: false },
};

export default async function BillingPage() {
  let workspace;
  try {
    workspace = await requireWorkspace();
  } catch {
    redirect("/login");
  }

  const polarService = new PolarService();
  const details = await polarService.getBillingDetails(workspace.id);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-ink">Billing &amp; Subscription</h1>
        <p className="text-sm text-ink-secondary mt-1">
          Manage your Nunuza Solo subscription, billing details, and receipts.
        </p>
      </div>

      <BillingClient details={details} />
    </div>
  );
}
