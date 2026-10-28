# Nunuza — Launch & Release Gate Checklist

**Product:** Nunuza v1.0.0 — Autonomous LinkedIn Content Operations Agent  
**Governing Standard:** Notion Product Specification v1.0, `docs/PRODUCT_SPEC.md`, BED-01 through BED-11  
**Last Updated:** 2026-10-28

---

## 1. Capability Release Gates Matrix

| Release Gate | Required For | Status | Evidence / Notes |
| :--- | :--- | :--- | :--- |
| **G-01: Supabase RLS & Cloud Schema** | All stages (Data Security) | **PASSED (LIVE)** | Migrations 0001–0005 applied to cloud DB. 21 tenant isolation tests pass with real authenticated users. |
| **G-02: AI Provider Pipeline (Groq)** | Content Generation | **PASSED (LIVE)** | Dynamic model resolution (`GroqProvider.resolveModel()`), `/openai/v1/models` discovery, candidate fallbacks. |
| **G-03: LinkedIn OAuth Client & Crypto** | LinkedIn Integration | **PASSED (CODE/KEYS)** | Client credentials validated against LinkedIn production token endpoint. Tokens encrypted AES-256-GCM. |
| **G-04: LinkedIn Real Publishing & Scope** | Live Publishing / Beta Cohort | **BLOCKED** | Pending LinkedIn Developer Application approval for `w_member_social`. Publishing fails closed. |
| **G-05: Telegram Bot Channel** | Remote Control | **PASSED (TESTED)** | 15-minute link tokens, SHA-256 pairing, command dispatcher (`/status`, `/drafts`, `/approve`, `/reject`, `/pause`, `/resume`). |
| **G-06: Remote MCP Server** | External AI Clients | **PASSED (TESTED)** | JSON-RPC 2.0 endpoint, `nunuza_mcp_...` bearer tokens, tenant isolation. `approve_draft` strictly excluded per BED-11. |
| **G-07: Polar Sandbox & Webhook Verification** | Billing & Checkout | **PASSED (TESTED)** | Standard Webhook HMAC-SHA256 signature verification, idempotency deduplication, out-of-order defense, 14-day trial state machine. |
| **G-08: Polar Seller Eligibility (BED-08)** | Live Paid Launch / Checkout | **BLOCKED (PRE-RELEASE)** | Live checkout remains disabled until legally responsible adult seller completes Polar onboarding. Preview remains unrestricted. |
| **G-09: Autopilot Safety Conditions** | Autonomous Mode | **GATED** | Enforced server-side: only allowed for `paid_trial` and `paid_active` workspaces. Never permitted in preview/beta. |

---

## 2. Pre-Release Stage vs. Full v1.0.0 Status

* **Stage 1 (Brand & Foundation):** COMPLETED
* **Stage 2 (Draft-only Preview):** OPERATIONAL (Unrestricted public drafting, planning, and export; no payment card required)
* **Stage 3 (LinkedIn Publishing Beta):** READY (Gated on official LinkedIn Developer App approval for `w_member_social`)
* **Stage 4 (v1.0.0 Release & Paid Launch):** GATED on Gates G-04 (LinkedIn Scope) and G-08 (Polar Seller Eligibility)
