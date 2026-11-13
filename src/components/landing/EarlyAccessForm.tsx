"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, LoaderCircle } from "lucide-react";

type FormState = "idle" | "submitting" | "success" | "error";

export function EarlyAccessForm() {
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "submitting") return;
    setState("submitting");
    setMessage("");

    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      linkedinUrl: String(data.get("linkedinUrl") ?? "").trim(),
      challenge: String(data.get("challenge") ?? ""),
      website: String(data.get("website") ?? ""),
    };

    try {
      const response = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "We couldn’t save your request. Please try again.");
      setState("success");
      form.reset();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    }
  }

  if (state === "success") {
    return (
      <div className="nz-early-success" role="status" aria-live="polite">
        <CheckCircle2 size={34} />
        <h3>You’re on the list.</h3>
        <p>Thanks for your interest. We’ll review your details and reach out personally about the next step.</p>
        <button type="button" className="nz-early-reset" onClick={() => setState("idle")}>Add another person</button>
      </div>
    );
  }

  return (
    <form className="nz-early-form" onSubmit={handleSubmit}>
      <div className="nz-early-field">
        <label htmlFor="early-name">Your name <span>Optional</span></label>
        <input id="early-name" name="name" type="text" autoComplete="name" maxLength={80} placeholder="Alex Morgan" />
      </div>
      <div className="nz-early-field">
        <label htmlFor="early-email">Work email <em>*</em></label>
        <input id="early-email" name="email" type="email" autoComplete="email" maxLength={254} placeholder="you@company.com" required />
      </div>
      <div className="nz-early-field">
        <label htmlFor="early-linkedin">LinkedIn profile <span>Optional</span></label>
        <input id="early-linkedin" name="linkedinUrl" type="url" autoComplete="url" maxLength={500} placeholder="https://linkedin.com/in/you" />
      </div>
      <div className="nz-early-field">
        <label htmlFor="early-challenge">What’s your biggest LinkedIn content challenge?</label>
        <select id="early-challenge" name="challenge" defaultValue="">
          <option value="">Choose one (optional)</option>
          <option value="finding ideas">Finding ideas worth posting</option>
          <option value="writing consistently">Writing consistently</option>
          <option value="sounding like me">Making posts sound like me</option>
          <option value="planning content">Planning content ahead</option>
          <option value="publishing workflow">Managing drafts and publishing</option>
          <option value="other">Something else</option>
        </select>
      </div>
      <div className="nz-early-honeypot" aria-hidden="true">
        <label htmlFor="early-website">Leave this field empty</label>
        <input id="early-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      {state === "error" && <p className="nz-early-error" role="alert">{message}</p>}
      <button className="nz-btn nz-btn-primary nz-early-submit" type="submit" disabled={state === "submitting"}>
        {state === "submitting" ? <><LoaderCircle size={17} className="nz-early-spin" /> Saving your spot…</> : <>Request early access <ArrowRight size={17} /></>}
      </button>
      <p className="nz-early-required">No payment details required. We’ll contact you before granting access.</p>
    </form>
  );
}
