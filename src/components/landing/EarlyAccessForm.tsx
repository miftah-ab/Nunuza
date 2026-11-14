"use client";

import { useId, useState, type FormEvent } from "react";

type FormState = "idle" | "submitting" | "success" | "error";

const Arrow = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M4 10h11m0 0-4.5-4.5M15 10l-4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Spinner = () => (
  <svg className="nze-spin" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeOpacity=".3" strokeWidth="2.4" />
    <path d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

export function EarlyAccessForm() {
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState("");
  const [sentTo, setSentTo] = useState("");
  const errorId = useId();

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
      setSentTo(payload.email);
      setState("success");
      form.reset();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    }
  }

  if (state === "success") {
    return (
      <div className="nze-success" role="status" aria-live="polite">
        <svg className="nze-tick" width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true">
          <circle cx="28" cy="28" r="26" className="nze-tick-ring" />
          <path d="M17 29l8 8 14-17" className="nze-tick-check" />
        </svg>
        <div>
          <h2>You’re on the list.</h2>
          <p>
            We’ll review your request and email{sentTo ? <> <b>{sentTo}</b></> : " you"} personally about the next step.
          </p>
          <button type="button" className="nze-link" onClick={() => setState("idle")}>Add another person</button>
        </div>
      </div>
    );
  }

  const submitting = state === "submitting";

  return (
    <form className="nze-form" onSubmit={handleSubmit}>
      <div className="nze-row">
        <div className="nze-field nze-email">
          <label htmlFor="early-email">Email</label>
          <input
            id="early-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={254}
            placeholder="name@email.com"
            required
            aria-invalid={state === "error"}
            aria-describedby={state === "error" ? errorId : undefined}
          />
        </div>
        <button className="nz-btn nz-btn-primary nze-submit" type="submit" disabled={submitting}>
          {submitting ? <><Spinner /> Saving</> : <>Request early access <Arrow /></>}
        </button>
      </div>

      {state === "error" && <p id={errorId} className="nze-error" role="alert">{message}</p>}

      <details className="nze-more">
        <summary>Add a few details <span>Optional</span></summary>
        <div className="nze-more-grid">
          <div className="nze-field">
            <label htmlFor="early-name">Name</label>
            <input id="early-name" name="name" type="text" autoComplete="name" maxLength={80} placeholder="Alex Morgan" />
          </div>
          <div className="nze-field">
            <label htmlFor="early-linkedin">LinkedIn profile</label>
            <input id="early-linkedin" name="linkedinUrl" type="url" autoComplete="url" maxLength={500} placeholder="https://linkedin.com/in/you" />
          </div>
          <div className="nze-field nze-wide">
            <label htmlFor="early-challenge">Your biggest LinkedIn content challenge</label>
            <select id="early-challenge" name="challenge" defaultValue="">
              <option value="">Choose one</option>
              <option value="finding ideas">Finding ideas worth posting</option>
              <option value="writing consistently">Writing consistently</option>
              <option value="sounding like me">Making posts sound like me</option>
              <option value="planning content">Planning content ahead</option>
              <option value="publishing workflow">Managing drafts and publishing</option>
              <option value="other">Something else</option>
            </select>
          </div>
        </div>
      </details>

      <div className="nze-honeypot" aria-hidden="true">
        <label htmlFor="early-website">Leave this field empty</label>
        <input id="early-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <p className="nze-privacy">We only use your details to contact you about Nunuza early access.</p>
    </form>
  );
}
