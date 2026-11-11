"use client";

import { useMemo, useState } from "react";
import { Loader2, Mic2, Play, Save, Sparkles } from "lucide-react";
import type { VoiceProfile } from "@/types/database";

type VoiceForm = {
  tone: string;
  sentence_length: string;
  formality: string;
  phrases_use: string;
  phrases_avoid: string;
  exclusions: string;
  sample_text: string;
};

function toForm(profile: VoiceProfile | null): VoiceForm {
  return {
    tone: profile?.tone ?? "",
    sentence_length: profile?.sentence_length ?? "",
    formality: profile?.formality ?? "",
    phrases_use: (profile?.phrases_use ?? []).join("\n"),
    phrases_avoid: (profile?.phrases_avoid ?? []).join("\n"),
    exclusions: (profile?.exclusions ?? []).join("\n"),
    sample_text: profile?.sample_text ?? "",
  };
}

function toLines(value: string): string[] {
  return [...new Set(value.split("\n").map((line) => line.trim()).filter(Boolean))];
}

export function VoiceEditor({ initialProfile }: { initialProfile: VoiceProfile | null }) {
  const [form, setForm] = useState<VoiceForm>(() => toForm(initialProfile));
  const [savedForm, setSavedForm] = useState<VoiceForm>(() => toForm(initialProfile));
  const [version, setVersion] = useState(initialProfile?.version ?? 0);
  const [updatedAt, setUpdatedAt] = useState(initialProfile?.updated_at ?? null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [testTopic, setTestTopic] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testProvider, setTestProvider] = useState<string | null>(null);

  const dirty = useMemo(() => {
    const current = JSON.stringify(form);
    return current !== JSON.stringify(savedForm);
  }, [form, savedForm]);

  function update<K extends keyof VoiceForm>(key: K, value: VoiceForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/voice", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tone: form.tone,
          sentence_length: form.sentence_length,
          formality: form.formality,
          phrases_use: toLines(form.phrases_use),
          phrases_avoid: toLines(form.phrases_avoid),
          exclusions: toLines(form.exclusions),
          sample_text: form.sample_text,
        }),
      });
      const json = await response.json() as { data?: VoiceProfile; error?: string };
      if (!response.ok || !json.data) throw new Error(json.error || "Could not save your voice profile.");
      const saved = json.data;
      setVersion(saved.version);
      setUpdatedAt(saved.updated_at);
      setSavedForm({ ...form });
      setMessage({ type: "success", text: "Voice profile saved. Future generations will use these settings." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not save your voice profile." });
    } finally {
      setSaving(false);
    }
  }

  async function testVoice() {
    if (testing || !testTopic.trim()) return;
    setTesting(true);
    setTestResult(null);
    setTestProvider(null);
    setMessage(null);
    try {
      const response = await fetch("/api/voice/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: testTopic.trim() }),
      });
      const json = await response.json() as { data?: { text: string; providerUsed: string }; error?: string };
      if (!response.ok || !json.data) throw new Error(json.error || "Voice test failed.");
      setTestResult(json.data.text);
      setTestProvider(json.data.providerUsed);
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Voice test failed." });
    } finally {
      setTesting(false);
    }
  }

  const fieldClass = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-forest";
  const labelClass = "mb-1.5 block text-xs font-semibold text-ink-secondary";

  return (
    <div className="space-y-6">
      <section className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Mic2 size={17} className="text-forest" />
            <h2 className="text-sm font-semibold text-ink">Writing style</h2>
          </div>
          <p className="text-xs text-ink-secondary">
            {version > 0 ? `Version ${version}` : "Not saved"}
            {updatedAt ? ` · Updated ${new Date(updatedAt).toISOString()}` : ""}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label><span className={labelClass}>Primary tone</span><input className={fieldClass} maxLength={120} value={form.tone} onChange={(e) => update("tone", e.target.value)} placeholder="e.g. Direct, thoughtful, practical" /></label>
          <label><span className={labelClass}>Sentence length</span><input className={fieldClass} maxLength={120} value={form.sentence_length} onChange={(e) => update("sentence_length", e.target.value)} placeholder="e.g. Short and punchy" /></label>
          <label><span className={labelClass}>Formality</span><input className={fieldClass} maxLength={80} value={form.formality} onChange={(e) => update("formality", e.target.value)} placeholder="e.g. Conversational, professional" /></label>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <label className="card p-5"><span className={labelClass}>Phrases and words to use</span><textarea className={fieldClass + " min-h-28"} value={form.phrases_use} onChange={(e) => update("phrases_use", e.target.value)} placeholder={"One phrase per line"} /><span className="mt-1 block text-[11px] text-ink-secondary">One phrase per line.</span></label>
        <label className="card p-5"><span className={labelClass}>Phrases and words to avoid</span><textarea className={fieldClass + " min-h-28"} value={form.phrases_avoid} onChange={(e) => update("phrases_avoid", e.target.value)} placeholder={"One phrase per line"} /><span className="mt-1 block text-[11px] text-ink-secondary">These are checked against generated drafts.</span></label>
      </section>

      <section className="card p-5 space-y-2">
        <label><span className={labelClass}>Topics and themes to exclude</span><textarea className={fieldClass + " min-h-24"} value={form.exclusions} onChange={(e) => update("exclusions", e.target.value)} placeholder={"One topic or phrase per line"} /></label>
        <p className="text-[11px] text-ink-secondary">Literal phrase matching blocks direct conflicts. It cannot detect every semantic variation.</p>
      </section>

      <section className="card p-5 space-y-2">
        <label><span className={labelClass}>Your writing sample</span><textarea className={fieldClass + " min-h-40"} maxLength={4000} value={form.sample_text} onChange={(e) => update("sample_text", e.target.value)} placeholder="Paste a piece of your own writing that represents your natural voice." /></label>
        <p className="text-[11px] text-ink-secondary">{form.sample_text.length}/4,000 characters. Use writing you own or have permission to use.</p>
      </section>

      {message && <div role="status" className={message.type === "error" ? "rounded-lg border border-error-light bg-error-light/30 p-3 text-sm text-error" : "rounded-lg border border-success-light bg-success-light/30 p-3 text-sm text-success"}>{message.text}</div>}

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving || !dirty} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {saving ? "Saving…" : "Save voice profile"}
        </button>
      </div>

      <section className="card p-5 space-y-3">
        <div className="flex items-center gap-2"><Sparkles size={17} className="text-forest" /><h2 className="text-sm font-semibold text-ink">Test your voice</h2></div>
        <p className="text-xs text-ink-secondary">Generate a private sample using your saved profile. This does not create a post or publish anything. Private previews are limited to 5 per hour. Save changes before testing. Previews always use the last saved profile.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className={fieldClass} value={testTopic} onChange={(e) => setTestTopic(e.target.value)} maxLength={300} aria-label="Topic for voice preview" placeholder="Enter a topic to write about" />
          <button type="button" onClick={testVoice} disabled={testing || dirty || !testTopic.trim()} className="btn-secondary inline-flex shrink-0 items-center justify-center gap-2 disabled:opacity-50">
            {testing ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {testing ? "Generating…" : "Test my voice"}
          </button>
        </div>
        {testResult && <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface p-4 space-y-2">
            <p className="text-xs font-semibold text-ink">Your reference writing</p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{savedForm.sample_text || "No writing sample saved. Add one above to make voice matching more specific."}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-4 space-y-2">
            <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-ink">Generated sample</p><span className="badge-active text-[10px]">{testProvider}</span></div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{testResult}</p>
          </div>
        </div>}
      </section>
    </div>
  );
}
