# Phase 0 Architecture Spike — Evidence Record

**Project:** Nunuza
**Phase:** 0 — Repository and platform spike (BED-04)
**Status:** IN PROGRESS
**Last updated:** 2026-10-27

---

## 1. Summary

Phase 0 is the mandatory architecture validation gate (BED-10, Gate 1). It must pass — or the predetermined fallback must pass — before any Phase 1 work begins. This document records commands run, versions, configuration, test results, limitations, blockers, and rollback instructions.

---

## 2. Workspace inspection result

Performed 2026-10-27. Finding: the workspace contained only `docs/PRODUCT_SPEC.md`. No existing Nunuza application, no infrastructure, no credentials, no deployment configuration.

---

## 3. Environment state at start of Phase 0

| Item | Version / Status |
|------|-----------------|
| OS | Windows 11 |
| Git | 2.55.0.windows.5 |
| Node.js | Not installed (install cancelled by founder) |
| npm / npx | Not installed |
| Wrangler CLI | Not installed |
| Supabase CLI | Not installed |
| Cloudflare account | Unknown — not confirmed |
| Supabase project | Unknown — not confirmed |
| LinkedIn developer app | Unknown — not confirmed |
| winget | v1.29.380 (available) |

---

## 4. Adapter research finding

**Finding (from official Cloudflare documentation):**
- `@cloudflare/next-on-pages` is **deprecated** for Next.js 15+.
- Current recommended adapter: **`@opennextjs/cloudflare`**, running on Cloudflare Workers with `nodejs_compat` flag.
- Supports: App Router, RSC, Route Handlers, Middleware, Server Actions, Streaming, ISR.
- Requires a custom worker entry point (`src/worker.ts`) that exports `queue()` and `scheduled()` handlers alongside the Next.js `fetch` handler.

This is a documentation finding, not a VERIFIED runtime test result. Runtime compatibility must still be confirmed by execution.

---

## 5. Spike scaffold files created

The following files were created as part of the spike project. They represent the intended architecture but no packages have been installed and no tests have been run.

| File | Purpose |
|------|---------|
| `spike/package.json` | Next.js 15 + @opennextjs/cloudflare + wrangler dependencies |
| `spike/wrangler.jsonc` | Cloudflare Workers config: nodejs_compat, Queue bindings (producer + consumer), Cron trigger (*/5 * * * *), dead-letter queue |
| `spike/tsconfig.json` | TypeScript strict mode, Workers types, bundler module resolution |
| `spike/src/` | Directory structure created; source files not yet written |

**Rollback:** Delete the `spike/` directory. No external resources have been created.

---

## 6. Test results

### T-01 to T-07 — Runtime compatibility

**Status: NOT VERIFIED**

Skipped per founder instruction (2026-10-27). The underlying BED-04 requirements have NOT been waived. These tests must be executed against a deployed environment before Phase 0 is considered passed. See revised plan (Section 8).

### T-08 to T-13 — Cloudflare Queue + Cron + durable job records

**Status: BLOCKED**

Requires: Cloudflare account authenticated via Wrangler, Cloudflare Queue created, Supabase project with `agent_jobs` table.

### T-14 to T-18 — Supabase authentication

**Status: BLOCKED**

Requires: Supabase project URL + anon key, Google OAuth app (client ID + secret) configured in Supabase Auth settings. No secrets to be shared in chat; must be provided via local `.env.local` file.

### T-19 to T-25 — LinkedIn feasibility

See `/docs/evidence/linkedin-access.md` for full source-cited findings.

| Test | Status |
|------|--------|
| T-19: Share on LinkedIn — self-serve (Open Permission) | VERIFIED |
| T-20: w_member_social scope | VERIFIED |
| T-21: POST /rest/posts, required headers, response format | VERIFIED |
| T-22: r_member_social restricted | VERIFIED |
| T-23: 3-legged OAuth flow, 60-day tokens, no standard refresh | VERIFIED |
| T-24: Rate limits — not published, must check portal | NOT VERIFIED (requires developer app) |
| T-25: Live OAuth + acceptance publish | BLOCKED (requires developer app + credentials + authorized test account) |

---

## 7. Key findings for implementation

1. **Adapter:** `@opennextjs/cloudflare` is the correct current adapter (confirmed from docs, not yet tested).
2. **Auth:** `@supabase/ssr` with `createServerClient` is the correct current package (deprecated alternative: `@supabase/auth-helpers-nextjs`).
3. **LinkedIn scope:** `w_member_social` only, self-serve — no manual LinkedIn approval needed to add the product.
4. **LinkedIn token refresh:** Standard apps do NOT get programmatic refresh. 60-day expiry requires user reconnect workflow.
5. **LinkedIn analytics:** `r_member_social` is restricted. v1 Performance page MUST use Nunuza workflow metrics.
6. **Rate limits:** Not published. Must check developer portal Analytics tab after first API request.

---

## 8. Revised Phase 0 test plan (T-01 to T-18)

### What changed

Local `wrangler dev` testing (T-01–T-07) was skipped by founder instruction. The minimum practical path to verify the required architecture is direct deployment to a Cloudflare preview/Worker environment.

### Minimum practical path (pending approval)

**Prerequisites the founder must provide before the next batch can proceed:**

| Prerequisite | Required for | How to provide |
|---|---|---|
| Cloudflare account (free OK) | All T-01 to T-13 | Run `wrangler login` in terminal |
| Cloudflare Queue created | T-08 to T-13 | After login: `wrangler queues create nunuza-spike-jobs` |
| Supabase project URL + anon key | T-09, T-11–T-18 | Add to `spike/.env.local` (file not committed) |
| Supabase service role key | T-09, T-11–T-13 (consumer) | Add to `spike/.env.local` (file not committed) |
| Google OAuth client ID + secret | T-14–T-18 | Configure in Supabase Auth settings dashboard (no secret needed in chat) |
| LinkedIn developer app | T-24, T-25 | Create at developers.linkedin.com, add "Share on LinkedIn" product |

**No credentials should ever be pasted into chat. All secrets go into local `.env.local` only.**

**Proposed next batch test sequence:**

1. Install Node.js LTS (can be done locally via winget, or the founder may already have it elsewhere)
2. Install packages: `npm install` in `spike/`
3. Authenticate: `wrangler login`
4. Deploy spike to Cloudflare Workers preview: `wrangler deploy --env preview`
5. Execute T-01 through T-07 against the deployed preview URL
6. Create Cloudflare Queue: `wrangler queues create nunuza-spike-jobs`
7. Execute T-08 through T-13 (Queue/Cron/Supabase job records)
8. Configure Supabase + Google OAuth
9. Execute T-14 through T-18 (Supabase auth)
10. Create LinkedIn developer app, add "Share on LinkedIn" product
11. Execute T-24 (check portal for rate limits)
12. With explicit authorization: Execute T-25 (acceptance publish)

### Fallback condition

If T-05 or T-06 (Middleware cookie handling) fail against the Cloudflare Workers deployment, the spec's predetermined fallback applies without further deliberation:
- Next.js deployed on Vercel (web app)
- Cloudflare Workers retained for Queue consumers and Cron Triggers
- Supabase retained for auth and database
- Same API contracts and security model

Switching to the fallback requires: (a) documented evidence of failure, (b) founder approval, (c) Vercel account.

---

## 9. Rollback instructions

**Current state rollback:** Delete `spike/` directory. No external resources have been created. `docs/` files are documentation only and can be removed or kept.

**After deployment (future batch):** Run `wrangler delete` to remove the deployed Worker. Delete the test Cloudflare Queue. Drop the spike-created Supabase tables. No production resources are affected.

---

## 10. Gate status

| Gate | Status |
|------|--------|
| BED-10 Gate 1: Phase 0 runtime spike passes | BLOCKED — awaiting founder-provided accounts and approval for next batch |

**Phase 0 is NOT complete. Phase 1 must not begin until Gate 1 is VERIFIED.**
