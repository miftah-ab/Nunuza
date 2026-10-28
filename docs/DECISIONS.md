# Nunuza — Decision Log

**Format:** Each entry records what was decided, why, what was rejected, and who decided.

---

## DECISION-001: Cloudflare Next.js adapter selection

**Date:** 2026-10-27
**Status:** DECIDED — pending runtime test verification
**Decided by:** Phase 0 spike investigation (based on official Cloudflare documentation)

**Decision:** Use `@opennextjs/cloudflare` as the Next.js adapter for Cloudflare Workers.

**Rationale:**
- `@cloudflare/next-on-pages` is officially deprecated for Next.js 15. Cloudflare's current recommended path is `@opennextjs/cloudflare`.
- `@opennextjs/cloudflare` supports App Router, RSC, Route Handlers, Middleware, Server Actions, Streaming, and ISR through `nodejs_compat`.
- The old `next-on-pages` adapter restricted all code to the Edge Runtime, which does not support Node.js APIs needed by Supabase SSR cookie handling.

**Rejected:** `@cloudflare/next-on-pages` — deprecated; insufficient Node.js API support for Supabase `@supabase/ssr`.

**Condition:** This decision remains provisional until T-01 through T-07 (runtime compatibility) and T-14 through T-18 (Supabase auth) are executed and VERIFIED. If the adapter fails those tests, the spec's predetermined fallback applies (Next.js on Vercel + Cloudflare Workers).

---

## DECISION-002: Supabase auth package selection

**Date:** 2026-10-27
**Status:** DECIDED — pending auth test verification

**Decision:** Use `@supabase/ssr` with `createServerClient` for server-side session handling in Next.js.

**Rationale:**
- `@supabase/auth-helpers-nextjs` is officially deprecated by Supabase.
- `@supabase/ssr` is the current supported package and is designed for App Router with `cookies()` from `next/headers`.
- Session refresh must happen in Next.js Middleware via `supabase.auth.getUser()` — not `getSession()` (which does not verify the token cryptographically).

**Rejected:** `@supabase/auth-helpers-nextjs` — deprecated.

---

## DECISION-003: LinkedIn OAuth flow type

**Date:** 2026-10-27
**Source:** Official LinkedIn documentation (authorization-code-flow, SRC-3)

**Decision:** Use 3-legged Authorization Code Flow (not PKCE, not client-credentials).

**Rationale:**
- LinkedIn's documented standard flow for member-authorized publishing uses the authorization code flow with `client_secret` server-side.
- PKCE is not documented as the standard path in the retrieved LinkedIn OAuth docs.
- Client credentials (2-legged) cannot act on behalf of a member and cannot post to a personal account.

**Important constraint documented:** Standard LinkedIn developer apps do NOT have programmatic refresh tokens. Access tokens expire after 60 days. Reconnect workflow is mandatory.

---

## DECISION-004: Skip T-01 through T-07 (local-only runtime tests)

**Date:** 2026-10-27
**Decided by:** Founder instruction (2026-10-27 15:41 UTC+3)

**Decision:** Tests T-01 through T-07 (local Next.js + Wrangler dev, no external accounts) are skipped. Node.js installation was cancelled.

**What this does NOT waive:** The underlying BED-04 requirements — server-rendered page, server endpoint, env bindings, logging, Middleware cookie handling — still must be tested and VERIFIED before Phase 0 is considered passed. The tests will be conducted against a deployed environment (Cloudflare preview/Workers) rather than local `wrangler dev`.

**Risk documented:** Runtime compatibility has not been tested locally. Any incompatibility will be discovered at deployment time rather than earlier. The fallback decision path (Vercel + Cloudflare) remains available per BED-04 §8.

---

## DECISION-005: Spike project scaffold pre-created

**Date:** 2026-10-27

**Files created during Phase 0 (spike directory — isolated, not the Nunuza application):**
- `spike/package.json`
- `spike/wrangler.jsonc`
- `spike/tsconfig.json`
- `spike/src/` directory structure

**Status:** Files exist; no packages installed; no deployment performed; no tests run. These files reflect the intended architecture but do not constitute a VERIFIED test result.
