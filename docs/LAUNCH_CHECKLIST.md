# Nunuza — Launch & Release Gate Checklist

**Product:** Nunuza v1.0.0 — Autonomous LinkedIn Content Operations Agent  
**Governing Standard:** Notion Product Specification v1.0, `docs/PRODUCT_SPEC.md`, `docs/DECISIONS.md`, BED-01 through BED-11  
**Last Updated:** 2026-10-28 (Phase 6 Release Readiness Audit)

---

## 1. Capability Release Gates Matrix

| Release Gate | Required For | Status | Evidence / Notes |
| :--- | :--- | :--- | :--- |
| **G-01: Supabase RLS & Cloud Schema** | All stages (Data Security) | **PASSED (LIVE)** | Migrations 0001–0005 applied to cloud DB (`xqsoeqklnecrdjrxioac.supabase.co`). 20 public tables & views discovered. Trigger `handle_new_user` and RPC `increment_usage_counter` verified. 21 tenant isolation tests pass with real distinct authenticated users. |
| **G-02: AI Provider Pipeline (Groq)** | Content Generation | **PASSED (LIVE)** | Dynamic model resolution (`GroqProvider.resolveModel()`), `/openai/v1/models` discovery, candidate fallbacks (`llama-3.3-70b-versatile` &rarr; `openai/gpt-oss-120b`). Character limits (<= 3,000) strictly enforced. |
| **G-03: LinkedIn OAuth Client & Crypto** | LinkedIn Integration | **PASSED (VERIFIED)** | Client credentials validated against LinkedIn token endpoint. Tokens encrypted at rest using AES-256-GCM. 8 tests passing in `src/lib/integrations/linkedin/client.test.ts`. |
| **G-04: LinkedIn Real Publishing & Scope** | Live Publishing / Beta Cohort | **READY (MEMBER OAUTH GATED)** | Developer Portal confirmed with self-serve products **"Share on LinkedIn"** (`w_member_social`) and **"Sign In with LinkedIn using OpenID Connect"** (`openid`, `profile`, `email`). Enterprise approval NOT required. `publishPostToLinkedIn` implemented via REST API 202410. Publishing fails closed until a member authorizes via `/api/integrations/linkedin/authorize`. |
| **G-05: Telegram Bot Channel** | Remote Control | **PASSED (TESTED)** | 15-minute link tokens, SHA-256 pairing, command dispatcher (`/status`, `/drafts`, `/approve`, `/reject`, `/pause`, `/resume`, `/report`, `/help`). 13 tests passing. |
| **G-06: Remote MCP Server** | External AI Clients | **PASSED (TESTED)** | JSON-RPC 2.0 endpoint over HTTP, `nunuza_mcp_...` bearer tokens, tenant isolation. `approve_draft` strictly excluded per BED-11. 13 tests passing. |
| **G-07: Polar Sandbox & Webhook Verification** | Billing & Checkout | **PASSED (TESTED)** | Standard Webhook HMAC-SHA256 signature verification, 300s replay window, idempotency deduplication in `billing_webhook_events`, out-of-order defense, 14-day trial state machine. 13 tests passing. |
| **G-08: Polar Seller Eligibility (BED-08)** | Live Paid Launch / Checkout | **GATED (PRE-RELEASE)** | Live checkout remains safely disabled (`POLAR_SELLER_ELIGIBLE !== "true"`) until legally responsible adult seller completes Polar onboarding. Preview remains unrestricted. |
| **G-09: Autopilot Safety Conditions** | Autonomous Mode | **GATED** | Enforced server-side: only allowed for `paid_trial` and `paid_active` workspaces. Strictly rejected for `draft_only` and `publishing_beta`. |

---

## 2. Binding Execution Decisions (BED-01 — BED-11) Reconciliation

| Decision | Specification Requirement | Implementation | Test Evidence | Dependencies | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BED-01** | Architecture: Next.js App Router, Cloudflare Workers/OpenNext, Supabase SSR | Next.js 16.4.3 App Router with `@opennextjs/cloudflare`, `@supabase/ssr` cookies | Next build webpack exit 0 (36 routes compiled), dev server operational | Node.js v24.22.1 | **VERIFIED** |
| **BED-02** | Publishing Limits: 1 post/day, 7 posts/week, draft_only cannot schedule | `src/lib/jobs/scheduling.ts` enforcing day bounds and rolling 7-day checks | `src/lib/jobs/scheduling.test.ts` (5 tests passing) | Database `content_posts` | **VERIFIED** |
| **BED-03** | LinkedIn OAuth: 3-legged code flow, AES-256-GCM token encryption, fail-closed publishing | `src/lib/integrations/linkedin/client.ts` and `crypto.ts`; `publishPostToLinkedIn` REST API 202410 | `src/lib/integrations/linkedin/client.test.ts` (8 tests passing) | Member OAuth consent via browser | **VERIFIED** |
| **BED-04** | Operational Architecture: Cloudflare queue & cron triggers, failover support | `src/worker.ts`, `src/lib/jobs/runner.ts` with lease management & retry backoff | `src/lib/jobs/runner.test.ts` (4 tests passing) | Cloudflare Workers runtime | **VERIFIED** |
| **BED-05** | Content Quality: Hook variations, voice rules, negative phrases, <= 3,000 chars | `src/lib/ai/prompts.ts`, `groq.ts`, `openrouter.ts`, `mock.ts` | `src/lib/ai/service.test.ts` (6 tests passing) | Groq API / OpenRouter | **LIVE VERIFIED** |
| **BED-06** | Human-in-the-Loop: Review, inline editing, draft export, audit logging | `ContentManager.tsx`, `src/lib/db/workspace.ts` audit logging | Component tests & manual UI audit | Supabase `audit_events` | **VERIFIED** |
| **BED-07** | Entitlement Matrix: Sole authority `entitlement_type`, free draft_only preview | `src/lib/auth/workspace.ts` with strict helper functions | `src/lib/auth/workspace.test.ts` (29 tests passing) | Supabase `workspaces` table | **LIVE VERIFIED** |
| **BED-08** | Commercial Structure: Nunuza Solo $29/mo, 14-day card-required trial, seller eligibility | `src/lib/integrations/polar/client.ts`, `service.ts`, `crypto.ts` | `src/lib/integrations/polar/service.test.ts` (13 tests passing) | Polar Sandbox / Seller Onboarding | **VERIFIED** (Live gated) |
| **BED-09** | Telegram Bot: 15-min pairing tokens, 1-active-link constraint, command dispatcher | `src/lib/integrations/telegram/service.ts`, webhook verification | `src/lib/integrations/telegram/service.test.ts` (13 tests passing) | Telegram Bot API | **VERIFIED** |
| **BED-10** | Pre-Release Gating: Live publishing blocked without real approval; preview free | `executePublishJob` in `scheduling.ts` fails closed when connection missing/unapproved | `src/lib/jobs/scheduling.test.ts` | User LinkedIn member login | **VERIFIED** |
| **BED-11** | Remote MCP: JSON-RPC 2.0, bearer auth, approve_draft strictly excluded | `src/lib/integrations/mcp/tools.ts`, `tokens.ts`, `/api/mcp/route.ts` | `src/lib/integrations/mcp/mcp.test.ts` (13 tests passing) | External MCP client | **VERIFIED** |

---

## 3. Pre-Release Stage vs. Full v1.0.0 Status

* **Stage 1 (Brand & Foundation):** COMPLETED
* **Stage 2 (Draft-only Preview):** OPERATIONAL (Unrestricted public drafting, planning, and export; zero payment card required)
* **Stage 3 (LinkedIn Publishing Beta):** READY (All code, scopes, and REST clients implemented; awaiting interactive member OAuth authorization via `/api/integrations/linkedin/authorize`)
* **Stage 4 (v1.0.0 Release & Paid Launch):** GATED on Gate G-08 (Polar Legally Responsible Seller Onboarding)
