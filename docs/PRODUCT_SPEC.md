# Nunuza — Product Specification v1.0 (Execution-Ready)

# BINDING EXECUTION DECISIONS (BED-01–BED-11) — v1.0

Status: AUTHORITATIVE. Read this section before implementing anything. These are the binding product and execution decisions for Nunuza v1.0.0. The complete v1.0.0 product scope includes the dashboard, LinkedIn publishing and scheduling, Telegram control, remote MCP server/tools, Autopilot under its paid and safety requirements, and Polar billing. The draft-only preview and LinkedIn publishing beta are pre-release validation stages, not separate numbered product versions and not a decision to defer Telegram or MCP beyond v1.0.0. Those pre-release stages may temporarily hide capabilities until their gates pass; v1.0.0 is not release-complete until every v1.0.0 capability is implemented and enabled as specified and every mandatory v1.0.0 release gate passes. No required capability may be waived as “not applicable.” Where this section clarifies or conflicts with older text below, follow this section. Antigravity must also copy these decisions into `/docs/PRODUCT_SPEC.md`, `/docs/DECISIONS.md`, and the relevant implementation docs. Do not ask the founder to make routine product or architecture decisions. Do not claim production readiness without passing the acceptance gates in this document.

## BED-01. Final target customer and positioning

### Primary customer (v1)

Solo founders and founder-led small businesses who use their personal LinkedIn profile to build credibility and generate business opportunities, but cannot maintain a reliable content workflow while running the business.

### Secondary customer

Independent consultants and small professional-service operators who use their personal LinkedIn profile to develop authority and attract qualified conversations.

### Not a launch target

Large marketing teams, agencies managing many client accounts, enterprise social teams, job seekers who only want career-post generation, and users who mainly want image/carousel design. Do not add multi-seat, agency, or multi-platform features to v1.

### Positioning statement

“Nunuza is a LinkedIn content operations agent for busy founders. It turns a founder’s strategy and voice into a reviewable content workflow. Scheduling, publishing, Telegram control and MCP access are enabled and marketed only when each capability has passed its release gate.”

### Differentiation

Do not position Nunuza as “another AI post writer.” The differentiator is the connected workflow: persistent strategy and voice preferences, planning, drafts and version history, approval/autopilot boundaries, durable scheduled jobs and clear activity logs. Dashboard control is core; Telegram and MCP control are required v1.0.0 channels and become available after each passes end-to-end verification. They are not deferred to a post-v1.0.0 version. Never claim this is unique in the market; competitors may offer overlapping features. Demonstrate the workflow rather than relying on unsupported comparative claims.

### Validation status

The target segment and willingness to pay are hypotheses until real users validate them. The website must not claim customer outcomes, retention, growth, or testimonials before verified evidence exists. The first 10–20 early users form the broader discovery cohort, not “paying customers” unless they actually pay. Recruit 5–10 design partners from this cohort; separately complete at least 10 customer interviews (target 15).

## BED-02. Pricing and packaging decision

Use one simple paid plan in v1 to reduce product complexity.

- Plan name: Nunuza Solo.
- Public list price: USD $29 per month.
- Trial: 14 days, card required, then converts to $29/month unless canceled, with the renewal amount, renewal timing, and cancellation path displayed immediately before checkout and on the billing page.
- Complete v1.0.0 scope, enabled only after each capability's own gate passes: one user, one workspace, one personal LinkedIn profile, one active content strategy, structured voice profile, content planning and drafting, approval-required workflow, bounded authorized Autopilot, internal scheduling, Telegram controls, remote MCP tools, content version history, activity log, and only those performance metrics available through approved LinkedIn API access. The draft-only preview and limited LinkedIn publishing beta are pre-release validation stages and may hide capabilities not yet cleared; they do not move Telegram, MCP, scheduling, publishing, Autopilot or billing out of v1.0.0. Never advertise or enable a capability, or expose actionable setup/control surfaces for it, before its gate passes. A neutral, non-promotional, status-only message such as “Integration not enabled” may explain an unavailable integration, but must not imply that it is usable or expose setup/control actions.
- Usage limits: up to 30 generated workflow items per billing month; hard product caps of no more than 1 Nunuza-scheduled post per LinkedIn profile per calendar day and 7 per rolling 7-day period. Users may choose lower limits but cannot raise these caps. One connected personal LinkedIn account, one Telegram account, and one active MCP credential set per workspace; credentials may be rotated, with the previous set revoked. A workflow item counts when Nunuza generates a new draft; revisions to the same draft do not consume another item unless the user explicitly duplicates it into a new draft. For paid workspaces, the 30-item allowance resets on the verified subscription billing-period boundary. For no-subscription workspaces with `draft_only` or `publishing_beta` entitlement, the same 30-item limit resets at 00:00 UTC on the first day of each calendar month; no billing period or subscription is implied. Display usage and reset date before the limit is reached.
- No annual plan, lifetime plan, add-ons, usage overages, coupons, or second paid tier in v1. Do not invent discounts or fake scarcity.
- If a payment fails, apply the billing provider's verified grace/retry state; never delete content. After the grace period, block new paid agent jobs and publishing but preserve read, export and cancellation access. Draft-only preview workspaces use the server-side `draft_only` entitlement and may create, edit, revise, organize and export drafts without an active subscription; this entitlement never authorizes LinkedIn publishing or paid features. Separately, only explicitly provisioned test-cohort workspaces may receive `publishing_beta`, which permits limited human-approved LinkedIn publishing after the LinkedIn release gate passes, without a Polar subscription. Neither entitlement bypasses usage or security controls.
- Trial and paid entitlements must be driven by verified server-side billing webhooks and provider API state, never a client-supplied plan name or URL parameter.
- Billing integration development uses provider sandbox/test products only, with unmistakable “TEST MODE — no real charge” labels. Local application flows may use clearly labeled test fixtures when an external integration is unavailable; fixtures must never be presented as a connected/live integration or substitute for release acceptance. Never use fake production prices as if checkout were live. Draft-only preview must start without live Polar product/price IDs; missing live billing configuration disables checkout only, not draft creation.

### Seller eligibility and live billing safety

Live Polar onboarding, checkout, and payouts must remain disabled until the legally responsible seller is eligible under the provider's current age, identity, country, tax, and payout requirements and has completed onboarding. Polar's published terms require users to be at least 18; therefore a minor must not create or operate a merchant account or bypass age/identity checks. If the founder is under 18, a parent/guardian or other eligible adult must independently agree to be the real seller and take responsibility for the account, finances, tax, customer support, and legal obligations. Do not misrepresent who owns the business. If no eligible seller is available, keep checkout and paid subscriptions disabled; this does not block the public no-charge draft-only preview or the no-charge limited LinkedIn publishing beta when their own gates pass. It does block paid launch and live checkout. This is a launch gate, not an invitation to bypass a provider's rules.

## BED-03. LinkedIn API critical-path decision

Official LinkedIn API access is a launch-critical dependency, not a detail to defer until the end.

### Implementation contract

- Use official LinkedIn OAuth and API endpoints only. No scraping, browser automation, cookie/session extraction, undocumented endpoints, or policy bypasses.
- Support personal member posting only in v1. Do not implement organization/company-page posting.
- Use the currently supported official Posts API and the current required version header at implementation time. Keep API version configurable and document the chosen version and sunset date in `/docs/INTEGRATIONS_LINKEDIN.md`.
- The app's scheduler is Nunuza's own durable scheduler. It stores scheduled times in the database and dispatches publishing jobs via Cloudflare Queues/Cron. Do not imply that LinkedIn itself is scheduling the post.
- Never hard-code a claim that LinkedIn allows 150 requests per member per day. LinkedIn's official rate-limit documentation says limits vary by endpoint and application and standard values are not published in the public docs; inspect the actual developer portal limits for the app and handle HTTP 429 responses safely.
- Google OAuth through Supabase Auth is the only application sign-in method. LinkedIn OAuth is used only to connect and authorize the user's personal LinkedIn account for publishing; it must never be presented or implemented as application login. Request only the LinkedIn scopes/product access required to connect the account and publish personal-member posts. Before launch, verify the app's actual approved products/scopes and perform a real end-to-end publish using an explicitly authorized test account.
- Store tokens encrypted at rest using a server-only encryption key; never return access/refresh tokens to the browser, Telegram, logs, MCP, or analytics. Refresh tokens only if the granted product supports them. If tokens expire and no refresh path is available, pause publishing and ask the user to reconnect.
- Persist the LinkedIn post URN returned by the API, response status, timestamps, API version and a redacted error category. Never record a post as published merely because a job was queued.
- Prevent duplicates with a stable idempotency key and a durable “publish attempt started / provider response received / outcome reconciled” state machine. If a timeout happens after request transmission and the outcome is ambiguous, persist the canonical job enum `needs_reconciliation` (display label: “Needs reconciliation”); do not blindly retry and risk double-publishing.
- Handle 401/403 with a clear reconnect/permission message; 429 with backoff and the provider reset guidance when available; transient 5xx/network errors with bounded exponential backoff and jitter; validation errors as non-retryable until the draft is fixed.
- Show a clear “LinkedIn publishing unavailable” state when API access or scope approval is absent. Users may still create, edit, export, and copy drafts. Do not label a mocked integration as connected and do not enable autopilot without a verified publishing capability.
- If publishing permission is not approved, the public no-charge pre-release is the “draft-only preview”: every public-signup workspace receives server-side `draft_only`, with no invitation or subscription, and may draft, review and export only. Signup never grants paid, internal-test or publishing-beta entitlements. Before the first real acceptance publish, an authorized administrator may provision a strictly restricted `internal_test` entitlement to a designated internal test workspace/account only after BOTH LinkedIn product/scope approval AND successful automated duplicate/idempotency tests; it is not available through public signup and cannot be used by customer workspaces. The first real test publish and reconciliation must pass before any customer-facing `publishing_beta` entitlement is granted. The LinkedIn publishing beta is a no-charge, limited-cohort pre-release: explicitly provisioned workspaces can publish only human-approved posts. Telegram and MCP are part of v1.0.0, not later product versions; they may be temporarily hidden in these pre-release stages but must be implemented, end-to-end tested and enabled for the v1.0.0 launch after their own gates pass. Autopilot is also in v1.0.0 scope but requires paid publishing entitlement and its own release gates.

### Required proof

Create `/docs/evidence/linkedin-access.md` with: app products approved, exact granted scopes (no tokens), API version, rate limits as seen in the developer portal, successful OAuth evidence, a successful real acceptance test publish and returned post URN (redacted if needed), reconciliation/duplicate-safety evidence, reconnect behavior, and failure tests. Only after LinkedIn product/scope approval is confirmed AND the automated duplicate/idempotency tests in BED-10 gate 4 pass may an authorized administrator provision the restricted `internal_test` entitlement to a designated internal test workspace/account. Use it for the first real test publish and reconciliation before any customer-facing `publishing_beta` entitlement is granted. This exception is limited to the acceptance test and is not public signup or customer entitlement. If either prerequisite is pending or denied, record the blocker and leave live publishing disabled.

## BED-04. Architecture spike and implementation order

**Version boundary:** the draft-only preview and LinkedIn publishing beta are pre-release validation stages, not numbered product versions. The first numbered product release is v1.0.0 and includes every capability in the binding scope, including Telegram and remote MCP. A capability may remain hidden while its security/provider gate is pending, but v1.0.0 cannot be marked complete or launched until all required capabilities and gates pass.

The exact Next.js-on-Cloudflare compatibility must be proven before implementing the whole UI.

### Phase 0 — repository and platform spike (must pass first)

1. Inspect the repository and existing deployment configuration before changing files.
2. Create a minimal Next.js + TypeScript route deployed to the chosen Cloudflare runtime using the currently supported adapter. Verify a server-rendered page, a server endpoint, Supabase Auth callback/session behavior, environment bindings, and logs.
3. Verify whether the chosen adapter supports all needed Next.js features. Do not assume Node APIs, filesystem access, arbitrary long-running tasks, or Node-only libraries are available in Workers.
4. Verify Supabase server-side auth/session handling in local and deployed preview environments.
5. Verify a Cloudflare Queue producer/consumer and Cron Trigger with a durable job record in Supabase. Prove retries and idempotency with a simulated failure.
6. Record exact commands, versions, config, results, limitations and rollback instructions in `/docs/architecture/phase-0-spike.md`.
7. In parallel with the runtime spike, begin the LinkedIn access feasibility spike immediately: verify the developer app's product/scope eligibility, OAuth flow, exact available member-posting permissions, API version and approval requirements. Record evidence in `/docs/evidence/linkedin-access.md`; do not wait until Phase 4 to discover access blockers.
8. If the selected Next.js adapter cannot reliably support the required app, use this predetermined fallback: deploy the Next.js web app on Vercel and keep the durable API/queue workers on Cloudflare. Do not spend days fighting unsupported runtime behavior. Keep Supabase as auth/database. The fallback must still use the same API contracts and security model.
9. Do not proceed to full application implementation until the runtime spike passes or the documented fallback passes. Continue LinkedIn feasibility work in parallel. If publishing access is blocked or pending, continue implementing the required v1.0.0 publishing integration and its safe interface behind a server-side disabled gate, mark live publishing BLOCKED, and record the exact external dependency. Do not enable or market unverified publishing capability, and do not use an unapproved workaround. A blocked publishing gate prevents v1.0.0 release completion; it does not prohibit safe implementation work.

### Runtime boundaries

- Workers and queue consumers must finish within platform execution limits; all long workflows must be resumable and checkpointed.
- Cron only wakes the scheduler and enqueues due work; it must not be the only durable record of a job.
- Database state is authoritative. Queue messages are delivery signals, not the only record of pending work.
- Use idempotent handlers, bounded retries, dead-letter handling, and a visible failed-job state.
- AI providers sit behind a server-side provider interface. Groq is primary and OpenRouter fallback; provider/model IDs and timeouts are configuration, not scattered constants.
- Add per-workspace rate/usage limits, max token/output limits, timeouts, cost estimation, and a provider circuit breaker. On provider failure, preserve drafts and show a retryable error; never silently fall back to a weaker provider without logging which provider/model was used.
- Never activate paid infrastructure or incur unapproved spend. Use free/test tiers where feasible, and document any unavoidable paid requirement before enabling it.

## BED-05. Content scope and roadmap decision

v1 remains text-only for organic personal LinkedIn posts. This is deliberate scope control, not a claim that images/documents are unimportant. Do not expand to images, carousels, videos, company pages, or other platforms in v1.

Before adding media, the product must first demonstrate: reliable authorized publishing, durable scheduling, no duplicate posts, useful voice adherence, user trust in approval/autopilot, and evidence that the current workflow solves a real customer problem. Track media as a post-v1 roadmap candidate only; do not build it preemptively.

## BED-06. Analytics and honest performance UI

Analytics are conditional on actual approved API access and data availability.

- The Performance page must distinguish four states: (1) data available with source and last-sync time, (2) no posts yet, (3) metrics unavailable because the app lacks approved scope/API support, and (4) sync failed/stale.
- Never display “0” when the value is unknown or inaccessible.
- Never fabricate impressions, likes, comments, followers, reach, engagement rate, benchmark comparisons, or growth percentages.
- If post-level analytics are not available, show useful operational metrics derived from Nunuza's own database: posts drafted, approved, scheduled, successfully published, failed jobs, and publication consistency. Label these as “Nunuza workflow metrics,” not LinkedIn performance metrics.
- Every metric has a definition, source, timestamp and a test. Store provider-reported metrics separately from Nunuza workflow events.
- If LinkedIn only permits a subset of analytics, render only that subset and a clear explanation. Do not use scraping to fill gaps.
- The overview dashboard should prioritize agent state, the next scheduled post for workspaces whose entitlement and gates enable scheduling (otherwise the next draft/review task for `draft_only`), drafts awaiting approval, integration status, usage, and recent activity over vanity charts.

## BED-07. Competitive positioning and proof

The market contains established AI writing, scheduling, and content workflow products. Nunuza must not claim to be the first, only, best, or uniquely compliant without evidence.

- The homepage compares Nunuza's workflow to the user's manual workload, not unverified competitor feature matrices.
- Build a competitor research document in `/docs/market/competitive-landscape.md` with date-stamped official-source checks for Taplio, Supergrow, ContentIn, AuthoredUp, and Stanley/GetStanley. Record product capabilities, public pricing, target audience, and evidence links. Distinguish confirmed facts from assumptions and re-check before public launch. Do not scrape competitor sites or copy their marketing.
- v1.0.0 positioning, used only after the corresponding capabilities are enabled: “A controlled LinkedIn content workflow that keeps your strategy, drafts, schedule and agent controls connected.” For the draft-only preview, the primary message is: “Your LinkedIn strategy, voice, and drafts in one workflow.” Draft-only preview copy must describe drafting, review and export only and must not imply that a `draft_only` workspace can schedule, publish or use Autopilot. Telegram and MCP must not be advertised as usable, enabled, or expose actionable setup/control surfaces to a workspace while their own gate is pending or the integration is disabled; a neutral status-only message such as “Integration not enabled” may explain the limitation. Once a gate passes, either may be enabled and accurately described in that pre-release build. Publishing beta claims must remain limited to explicitly provisioned `publishing_beta` workspaces and human-approved publishing. All these capabilities remain required for v1.0.0.
- Do not lead with “AI writes better posts.” Demonstrate how the system preserves a user's strategy/voice, manages approvals, and reconciles scheduled jobs.
- Do not publish testimonials, customer logos, case studies, usage numbers or outcome claims without documented consent and verifiable evidence.

## BED-08. Customer discovery and launch sequence

Do not build for months based only on assumptions. Run discovery in parallel with implementation, without pretending interest equals payment.

### Before public paid launch

- Interview at least 10 people in the primary target segment; aim for 15, with a hard minimum of 10 completed conversations before treating the target segment as validated.
- Ask about recent real behavior: how they planned their last five LinkedIn posts, what took time, what they currently use/pay for, what happens when they stop posting, what they tried and abandoned, and what would make them trust an agent to publish.
- Do not ask only “Would you use Nunuza?” or lead respondents toward positive answers.
- Recruit 5–10 design partners to use the working draft/approval workflow. A design partner is not a customer unless they pay.
- Collect consent before recording or quoting anyone. Store interview notes without unnecessary personal data.
- Record findings in `/docs/discovery/interviews.md` and a simple table: problem frequency, current workaround, consequence, willingness-to-pay evidence, objections, requested capabilities, and whether each point is observed or inferred.
- A problem is not validated just because someone likes the idea. Stronger evidence includes repeated recent pain, current spend or substantial effort, active use during the pilot, and willingness to pay a stated price.
- Do not claim validation if the minimum interview target is not met. If fewer than 3 of 10 interviewees describe recurring pain and a concrete current workaround, pause expansion and revise positioning before adding features.
- During the first 10–20 real users, instrument onboarding drop-off by step, time to first useful draft, approval rate, revision rate, scheduled-to-published success, pause/disable reasons, weekly active use, trial-to-paid conversion, cancellations, and support incidents. Do not collect more personal data than needed.
- Conduct weekly feedback reviews during the first 30–50 paying users. Prioritize issues based on frequency and severity; do not automatically build every requested feature.

### Launch stages

1. Local development and automated tests.
2. Draft-only preview with no claim of live publishing; Google signup automatically provisions draft-only access.
3. LinkedIn publishing beta with approved LinkedIn access and a small, consented test cohort; use this label only after the real end-to-end test publish passes.
4. v1.0.0 release and paid launch only after every v1.0.0 capability gate passes, including real LinkedIn publishing/reconciliation, Telegram, remote MCP, Autopilot, Polar billing, legal, security, reliability and seller eligibility. This is the first numbered product release; if any required gate is blocked, v1.0.0 is not release-complete and the product remains in a clearly labeled pre-release stage.
5. Broader public launch of that same v1.0.0 release only after the product has real customer evidence and all marketing claims match the deployed product. Stage 5 is not a later product version and does not replace the stage-4 v1.0.0 release gate.

## BED-09. Trust, retention and operational requirements

- Approval Required is the only mode in the draft-only preview and in the LinkedIn publishing beta. Autopilot is part of v1.0.0 scope but remains unavailable during these pre-release stages. Enable it for the v1.0.0 paid launch only after approved LinkedIn publishing access, a successful end-to-end test publish, all Autopilot-specific release gates and a valid paid publishing entitlement are verified. Once enabled, it must be visibly enabled and bounded by the hard daily/weekly caps, allowed pillars, prohibited topics and quiet hours.
- Every autonomy change, approval, rejection, publish attempt, integration disconnect, token failure, retry, and billing entitlement change creates an audit event.
- “Pause” prevents queued-but-not-started publish jobs; in-flight publish attempts must be reconciled. The UI must say when an already-submitted post cannot be recalled.
- A user can export drafts, published-post records, content versions and their settings in a portable format regardless of trial/subscription status, including after cancellation or expiration. Deletion must revoke credentials and schedule deletion according to a documented retention policy, while preserving only records legally required for billing/security. Clearly document any provider-owned data that cannot be exported.
- Add a visible status page/state for LinkedIn outage or API access restrictions; do not suggest Nunuza can control LinkedIn availability.
- Use idempotency for all mutation routes that may be retried. Use request IDs and structured redacted logs.
- All writes must validate workspace membership on the server and use Supabase RLS. Test cross-tenant access attempts for every table and endpoint.
- Exactly one active MCP credential set is allowed per workspace in v1. It must be high entropy, hashed at rest where possible, workspace-scoped, revocable, rotatable and shown only once at creation; rotation revokes the previous set. Never expose the credential again. Require authentication for all tools; validate schemas and permissions server-side.
- Telegram linking tokens must be single-use, short-lived, random, and bound to the authenticated workspace. Do not trust user-supplied workspace IDs or Telegram IDs. Validate webhook secret/token and rate-limit commands.
- Provide clear data-handling explanations for AI providers, LinkedIn, Telegram, Supabase, Cloudflare, and the billing provider. Send only the minimum context needed to generate content. Never send secrets or unrelated workspace data to an AI provider.

## BED-10. Required launch artifacts and gates

Antigravity must create and maintain these files:

- `/docs/PRODUCT_SPEC.md` — complete product spec, including this binding addendum.
- `/docs/BRAND.md` — logo filenames, tokens, typography, spacing, components, responsive rules.
- `/docs/DECISIONS.md` — dated decisions, rationale, alternatives rejected, and any future change.
- `/docs/architecture/phase-0-spike.md` — deployment/runtime spike evidence.
- `/docs/INTEGRATIONS_LINKEDIN.md` and `/docs/evidence/linkedin-access.md`.
- `/docs/INTEGRATIONS_TELEGRAM.md`, `/docs/INTEGRATIONS_MCP.md`, `/docs/INTEGRATIONS_POLAR.md`.
- `/docs/market/competitive-landscape.md`.
- `/docs/discovery/interviews.md` and a design-partner feedback log.
- `/docs/SECURITY.md`, `/docs/OPERATIONS.md`, `/docs/LAUNCH_CHECKLIST.md`.
- `/.env.example` containing variable names and safe placeholders only; never commit real secrets.
- Automated unit, integration, security/RLS, accessibility smoke, responsive, and end-to-end tests with commands documented.

### Hard release gates and applicability

The following gates are mandatory for the production capabilities that depend on them. The draft-only preview and limited publishing beta are pre-release validation stages and may run with specific capabilities safely hidden/disabled while their gates are pending. A pre-release stage may be called complete only against its own explicitly limited acceptance criteria; that does not mean v1.0.0 is complete. Every capability in the v1.0.0 scope—including LinkedIn publishing/scheduling, Telegram, remote MCP, Autopilot and Polar paid billing—must be implemented, enabled where applicable, and pass its own gate before v1.0.0 is declared release-complete. If any required gate remains BLOCKED, v1.0.0 remains BLOCKED and must not be represented as launched. No gate may be bypassed to advertise or expose a capability that has not passed its own requirements.

1. Phase 0 runtime spike passes or the predetermined Vercel + Cloudflare fallback passes. Required for every deployed stage.
2. Google sign-in, protected routes, session renewal, logout and workspace isolation pass. Required for every deployed stage.
3. Actual LinkedIn publishing product/scope must be approved and the duplicate/idempotency safety tests in gate 4 must pass before an administrator may grant the restricted `internal_test` entitlement to a designated internal test workspace/account. Use it to perform the first real test publish and reconciliation acceptance test. Only after that test passes may any customer-facing `publishing_beta` entitlement be granted or live publishing enabled for the beta cohort. Until then, public workspaces remain `draft_only`.
4. No duplicate publishing under retries, timeouts, queue redelivery or concurrent jobs. Automated duplicate/idempotency tests are required before the restricted internal acceptance-test publish; successful real test-publish reconciliation is required before customer-facing beta publishing. Full evidence is required before v1.0.0 release completion.
5. Telegram linking and commands pass authorization, replay, expiry and rate-limit tests. Required before Telegram is enabled for any user and before v1.0.0 is release-complete. It may be hidden during pre-release preview/beta validation while its gate is pending.
6. Remote MCP read/write tools pass authentication, scope, revocation, schema-validation and cross-tenant tests with at least one documented target client. Required before MCP is enabled for any user and before v1.0.0 is release-complete. It may be hidden during pre-release preview/beta validation while its gate is pending.
7. Polar sandbox trial, webhook signature verification, activation, renewal, cancellation, failed payment and entitlement transitions pass. Required before paid trial/checkout is enabled and before v1.0.0 paid launch. It does not block the no-charge draft-only preview or no-charge LinkedIn publishing beta. Live checkout remains disabled until the seller is legally eligible and onboarding/terms/prices are verified.
8. Every visible button has working behavior; no dead links, fake charts, fabricated integrations, placeholder testimonials or hidden TODOs.
9. Responsive checks pass at 320, 375, 390, 768, 1024 and 1440px with no page-level horizontal overflow.
10. Keyboard navigation, visible focus, form labels, contrast and reduced motion receive an accessibility pass.
11. Secret scanning, dependency audit, RLS tests, authorization tests and redacted logging pass.
12. Terms/privacy/cancellation disclosures are reviewed by the legally responsible adult/business owner before public paid launch.
13. All live environment variables and service accounts are supplied through secure configuration. No secrets in source code or docs.
14. `/docs/LAUNCH_CHECKLIST.md` contains evidence for each gate, not just checkboxes marked complete without proof.
15. Autopilot is enabled only for a verified `paid_trial` or `paid_active` workspace after LinkedIn product/scope approval, a successful real end-to-end test publish and reconciliation, all duplicate/idempotency controls, and all security/reliability gates pass. The user must explicitly enable Autopilot after seeing a plain-language summary of permitted actions. Automated and end-to-end tests must prove that Autopilot is rejected for `draft_only`, `internal_test` and `publishing_beta`; fails closed when entitlement, integration, token, agent state or policy is invalid; respects hard daily/weekly caps, quiet hours, allowed pillars and prohibited topics; never publishes ambiguous or out-of-policy content without human approval; supports pause/disable with in-flight reconciliation; and records auditable authorization changes and publish outcomes. This gate is mandatory for v1.0.0 release completion.

### Antigravity execution protocol

- Inspect the existing repository first. Do not delete or rewrite existing work blindly.
- Convert this spec into an implementation checklist with traceable requirement IDs.
- Work in small phases; after each phase, run the relevant tests and fix failures before continuing.
- Maintain `/docs/IMPLEMENTATION_STATUS.md` with each requirement marked NOT STARTED / IN PROGRESS / BLOCKED / VERIFIED, plus the test or evidence supporting VERIFIED.
- A mock may be used in local development only if clearly labeled and isolated behind an interface. Never represent a mock as a live integration.
- If an external blocker exists, complete all independent work, build a clear disabled state and document the exact required external action. Do not silently replace the integration with browser automation or invent credentials.
- Never mark a requirement VERIFIED based only on code existing; run the test and record its result.
- At the end of each phase, summarize files changed, commands run, tests passed/failed, remaining blockers and next phase. Do not declare production readiness until every hard release gate passes.

## BED-11. Resolution of the original review weaknesses

- Target customer ambiguity: resolved by BED-01 and BED-08; founder-led businesses are primary, consultants secondary.
- Release-scope ambiguity: v1.0.0 is the first numbered release and requires every listed capability gate, including Telegram, remote MCP and Autopilot. Preview/beta are pre-release validation stages only; a blocked capability means v1.0.0 remains blocked.
- Media feature pressure: resolved by BED-05; v1 remains text-only until operational reliability and customer evidence justify expansion.
- Analytics gap: resolved by BED-06; only real available metrics, with explicit unavailable/stale/no-data states and operational metrics as a fallback.
- Pricing/value story: resolved by BED-02; one $29/month plan and a 14-day trial only after paid-launch gates pass. Telegram/MCP are advertised as available only after end-to-end verification.
- Cloudflare/Next.js uncertainty: resolved by BED-04 and its mandatory Phase 0 spike and predetermined Vercel + Cloudflare fallback.
- LinkedIn API access: resolved as a launch-critical gate with no fake connection or bypasses in BED-03.
- Distribution and proof: resolved by customer discovery, design partners, measured onboarding/retention, and claim restrictions in BED-07–BED-08.
- Unit economics and AI quota risk: resolved by server-side usage limits, provider timeouts/circuit breaker, token limits, usage metering, and one-plan packaging in BED-02 and BED-04.
- Trial/billing/seller eligibility: resolved by BED-02; test-mode implementation can proceed, but live selling must not bypass the provider's eligibility rules.

This addendum resolves product decisions that can be made now. It does not pretend external approvals, legal review, domain ownership, credentials, or seller eligibility can be manufactured by software. Those remain explicit launch gates; all work independent of them must still be implemented and tested.

> **Authority:** This is the source of truth for Nunuza v1.0.0. Antigravity must implement this specification and must not invent product behavior, branding, routes, data models, permissions, pricing, or integrations. If a decision is explicitly marked **OPEN / BLOCKER**, do not guess; use a safe disabled state and report the blocker.
> 

<aside>
📌

**v1.0.0 product scope (target release; not a claim that deployment is already complete):** Nunuza is a proactive LinkedIn content operations agent for solo founders and small founder-led businesses. The v1.0.0 scope includes planning, drafting, scheduling and authorized LinkedIn publishing, background operation, dashboard controls, Telegram, remote MCP and bounded Autopilot under their respective release gates, plus Polar billing. **Pre-release validation stages:** the draft-only preview permits drafting, review and export only; the separate LinkedIn publishing beta permits limited human-approved publishing only for explicitly provisioned test-cohort workspaces after the real acceptance publish and reconciliation gates pass. Preview/beta restrictions do not defer any capability beyond v1.0.0.

</aside>

# 1. Product decisions and status

## Locked decisions

- Product name and spelling: **Nunuza** (capital N, remaining letters lowercase).
- Product category: autonomous LinkedIn content operations SaaS.
- Initial target customer hypothesis: solo founders and founder-led businesses using LinkedIn to build professional visibility and attract business opportunities. This audience is a hypothesis to validate, not a proven market.
- Marketing homepage: premium, polished, conversion-focused SaaS site inspired by the clarity and quality of GetStanley, without copying its text, layout, brand, graphics or assets.
- Authentication: Google sign-in only through Supabase Auth. No email/password, magic link or LinkedIn login for application authentication in v1.0.0.
- UI stack: Next.js, TypeScript, Tailwind CSS, shadcn/ui and Lucide icons.
- Typography: Inter.
- Brand palette: primary forest green #174C3C; hover forest #103B2F; warm off-white #F8F8F5; surface white #FFFFFF; primary text #202522; secondary text #68716C; border #E4E8E3. Semantic status colors: success #287A50, warning #A86412, error #B93838. Maintain accessible contrast and never rely on color alone.
- Database and authentication: Supabase PostgreSQL and Supabase Auth.
- Compute direction: Cloudflare Workers for HTTP/API and suitable event-driven work; Cloudflare Queues for asynchronous jobs; Cron Triggers for scheduled wake-ups. Validate the exact Next.js deployment adapter and runtime compatibility before production.
- AI providers: Groq primary and OpenRouter fallback behind a provider abstraction. Never hard-code model names or API keys into UI/client code. Configure model IDs, limits and provider availability through server-side environment/config.
- Messaging: Telegram Bot API.
- Publishing: official LinkedIn APIs only.
- External AI integration: remote MCP server is a v1.0.0 requirement and must be implemented, end-to-end tested and enabled for the v1.0.0 launch after its MCP gate passes; preview/beta builds may hide it temporarily while that gate is pending.
- Billing: Polar.
- Commercial offer after launch gates: one Nunuza Solo plan at USD $29/month with a 14-day card-required trial, converting to $29/month unless canceled. Do not send every signup to checkout by default. During the draft-only preview, Google signup automatically provisions a workspace with the `draft_only` entitlement; no invitation or payment card is required. This pre-release preview supports drafting, review and export only. Live publishing and scheduling remain unavailable to `draft_only` workspaces; Telegram and MCP remain hidden only while their own gate is pending or the integration is disabled. Autopilot remains disabled throughout preview/beta even if its technical gate work is complete, and may be enabled only for v1.0.0 paid workspaces after its dedicated gate and paid-entitlement requirements pass. Checkout remains disabled until all paid-launch gates pass. Telegram, MCP, scheduling, publishing, Autopilot and Polar billing remain required components of v1.0.0, not post-v1.0.0 features.
- Responsive design is a release requirement, not a later enhancement.
- Logo and logo variations are created and approved in Antigravity. Antigravity is allowed to design the logo, but must treat the approved logo files as locked assets afterward and reuse them consistently.

## Open items that must not be invented

- Public domain name and domain availability.
- Final trademark/name clearance.
- LinkedIn API access and actual permissions granted to the app.
- Production payment processing still requires verified seller eligibility, account onboarding, provider product/price IDs, legal disclosures and end-to-end webhook tests. The v1 commercial offer and limits are already fixed in the binding pricing decision above: Nunuza Solo at USD $29/month, one plan only, with a 14-day card-required trial after the paid-launch gates pass. Do not treat pricing or plan limits as open decisions. For billing integration tests, use provider sandbox/test products only and keep live checkout disabled until every live-billing gate passes. Use clearly labeled local test fixtures only for application data or integrations that are not yet available; fixtures do not count as release acceptance.
- Production deployment account, secrets, and spend approval.
- Final brand logo files: create in the brand task, review, then lock the chosen files.
- Public launch legal text (Terms, Privacy Policy, cancellation disclosures) requires founder review; do not invent claims about legal compliance.

# 2. Product goals and non-goals

## Goals for v1.0.0

1. Help a customer maintain a consistent LinkedIn publishing workflow with less daily manual work.
2. Let a customer configure an audience, professional goals, content pillars, writing voice, boundaries and posting cadence.
3. Create, review, edit, approve, schedule and publish text posts using supported LinkedIn API access.
4. Keep agent jobs and their state on the server so work continues when the dashboard, Telegram or an external AI session is closed.
5. Give users a clear view of what the agent did, what it plans to do, what needs approval and what failed.
6. Offer meaningful control through the web dashboard in the pre-release preview; Telegram and remote MCP controls are required in v1.0.0 and must be enabled for that launch after each integration passes its own end-to-end gate. They may be hidden only in preview/beta builds while the relevant gate is pending.
7. After all paid-launch gates pass, support the single Nunuza Solo offer ($29/month) with a 14-day card-required trial and subscription lifecycle through Polar. Before then, checkout remains disabled and pre-release preview/beta workspaces must not ask for a payment card. The draft-only preview and LinkedIn publishing beta are pre-release stages; only explicitly provisioned test-cohort workspaces may receive `publishing_beta` for limited human-approved publishing after the internal test publish and LinkedIn release gates pass. Telegram and remote MCP remain mandatory v1.0.0 capabilities even if temporarily hidden in these pre-release stages.
8. Enforce tenant isolation, least privilege, safe publishing, auditability and recoverable jobs.

## Explicit non-goals for v1.0.0

The following list narrows the product scope without deferring required v1.0.0 capabilities. Telegram control, remote MCP, LinkedIn scheduling/publishing, bounded Autopilot and Polar billing are all included in v1.0.0; their gates determine when they can safely be enabled, not which product version they belong to.

- No LinkedIn scraping, browser automation, cookie injection, or attempts to bypass platform restrictions.
- No automated connection requests, mass direct messages, engagement farming, fake engagement, or automated comments/likes.
- No guarantee of leads, revenue, impressions or follower growth.
- No fabricated analytics or simulated live performance.
- No multi-platform publishing beyond LinkedIn.
- No team workspaces or agency seat management in the first release.
- No image/video/carousel generation or publishing unless a later approved scope adds it; v1.0.0 supports text-only posts to keep the API and workflow narrow.
- No AI-generated brand logo at runtime. Logo is a static approved project asset.
- No custom model training or claims that the system learns from private data beyond the defined saved preferences and measured outcomes.
- No unrestricted MCP access to user accounts.
- No hidden billing or trial conversion.

# 3. Primary user journey

1. Visitor lands on the public homepage.
2. Visitor sees only claims, features and calls to action enabled for the current release. The draft-only preview must not show a live checkout or imply live publishing is available.
3. Visitor selects “Try the draft-only preview,” signs up with Google, and automatically receives a server-side `draft_only` entitlement for the new workspace during the draft-only preview. No invitation is required. Signup never grants paid or publishing-beta entitlements. The separate LinkedIn publishing beta is limited to explicitly selected and provisioned test-cohort workspaces.
4. Application creates a user/workspace and starts resumable onboarding.
5. User sets professional profile, audience, goals, content pillars, voice preferences, topics to avoid, preferred cadence and time zone.
6. LinkedIn connection can be explored through official OAuth where available, but publishing stays blocked for all workspaces until the required API product/scopes are approved and the end-to-end publish/reconciliation gate passes. After that gate, only explicitly provisioned `publishing_beta` workspaces and workspaces with a valid paid publishing entitlement may publish; ordinary `draft_only` workspaces remain draft-only.
7. The draft-only preview and LinkedIn publishing beta have no checkout or payment-card step. A provisioned `publishing_beta` workspace may publish only under the limited human-approved test-cohort rules after the LinkedIn publishing gate passes; it does not receive paid entitlements. After every paid-launch gate passes, eligible users may use the single Nunuza Solo Polar checkout for the 14-day card-required trial at $29/month, with renewal and cancellation disclosures immediately before checkout.
8. During any pre-release draft-only preview or LinkedIn publishing beta build, if Telegram or MCP's own gate is pending or that integration is explicitly disabled, the Integrations page may show only a neutral, non-promotional status message such as “Integration not enabled.” Do not expose link/unlink, endpoint setup, connection instructions, credential creation, rotation, or control actions until that integration's gate passes and it is enabled. Do not label the limitation as specific to “this preview,” because the same gate-specific rule applies in beta. Once each gate passes, expose that integration in the current build subject to entitlement and tool-level permissions; do not defer it to a post-v1.0.0 version. The integration's temporary absence does not block a pre-release stage's limited acceptance, but it blocks v1.0.0 release completion.
9. The draft-only preview uses Approval Required and disables scheduling/publishing controls. The LinkedIn publishing beta also uses Approval Required; its explicitly provisioned `publishing_beta` entitlement permits only human-approved publishing within beta limits. Autopilot is required in v1.0.0 but remains disabled during these pre-release stages; enable it for the v1.0.0 paid launch only after its own gates pass and a paid publishing entitlement is valid.
10. The agent creates a content plan and drafts. A `draft_only` workspace never publishes. A designated `internal_test` workspace may perform only the restricted acceptance-test publish after LinkedIn product/scope approval is confirmed AND automated duplicate/idempotency tests have passed, and an authorized administrator provisions the entitlement. A `publishing_beta` workspace may publish only a draft explicitly approved by an authenticated human and only after the real acceptance publish and duplicate/reconciliation gates pass. In the v1.0.0 paid workflow, Autopilot can publish only within verified permissions and hard limits after its own gates pass.
11. Dashboard and any enabled integrations display consistent state from the same backend.
12. User can pause, disconnect integrations, export their content and request account deletion; paid users can also cancel their subscription.

# 4. Brand and design system

## Brand lock instructions for Antigravity

- Create a distinct, professional Nunuza symbol + wordmark. Do not copy GetStanley or any competitor logo.
- Deliver approved assets: primary horizontal logo, icon-only mark, light/dark-compatible versions where needed, favicon/app icon and SVG files. Prefer SVG for scalable brand marks.
- Keep source/export files in a dedicated path such as `/public/brand/`; document the chosen asset filenames in `/docs/BRAND.md`.
- Do not create alternate logos after approval. Do not approximate the logo with text, emoji, an arbitrary Lucide icon or a CSS shape.
- If logo approval is pending, use a clearly marked development placeholder only in local development. Do not ship a placeholder to production.
- Product name must be exactly “Nunuza” across metadata, UI, email copy, billing descriptions and documentation.
- Do not use the phrase “powered by AI” as the primary brand idea. Emphasize proactive LinkedIn operations and user control.

## Visual style

- Clean, premium B2B SaaS. Use white/off-white surfaces, forest-green primary actions, charcoal text, restrained borders and subtle shadows only when useful.
- No purple/blue gradients, neon, glowing cards, excessive glassmorphism, floating blobs, random AI-generated people, robot/brain imagery, excessive rounded cards, emoji-as-icons, fake dashboard metrics or decorative charts without meaning.
- Use Inter. Use a consistent type scale: page title 28–32px, section title 18–20px, body 14–16px, secondary 13–14px. Responsive sizing is allowed but keep hierarchy consistent.
- Lucide icons only unless a specific approved asset requires otherwise. Sidebar icons normally 18–20px, inline/action icons 16–18px. Pair navigation icons with labels; icon-only actions require accessible names and tooltips.
- Define design tokens in one central theme file. Do not scatter raw hex values throughout components.
- Use consistent spacing, keyboard focus indicators, visible labels, accessible contrast, reduced-motion support and semantic HTML.

## Responsive and accessibility acceptance

Test at viewport widths 320, 375, 390, 768, 1024 and 1440px, plus intermediate sizes. No horizontal page overflow. Mobile layouts must not simply shrink desktop tables. Use stacked cards or intentionally scrollable table containers where appropriate. Dialogs, forms, calendar, editor and approval actions must work with touch and keyboard. Target WCAG 2.2 AA practices where feasible.

# 5. Marketing website

Public routes:

- `/` home
- `/pricing` pricing
- `/privacy` privacy policy (founder-reviewed text before production)
- `/terms` terms (founder-reviewed text before production)
- `/login` Google sign-in
- `/auth/callback` OAuth callback

Homepage sections, in this order:

1. Header with approved logo, product navigation and primary CTA.
2. Hero headline for the draft-only preview: “Your LinkedIn strategy, voice, and drafts in one workflow.” Supporting text: “Plan and refine LinkedIn posts in a reviewable dashboard. This preview supports drafting and review; publishing and scheduling are unavailable to draft-only workspaces.” Do not state that Telegram or MCP are unavailable if their own gates have passed and they are enabled in this pre-release build; describe them only for the workspaces and actions actually authorized. Autopilot remains unavailable during preview/beta. The primary CTA is “Try the draft-only preview” and opens the Google signup path that provisions a draft-only workspace; it must not open checkout or request a payment card. Only after all v1.0.0 capability and paid-launch gates pass may the site be presented as the v1.0.0 paid release and the CTA become “Start your 14-day free trial”.
3. Show the 14-day card-required trial disclosure only when live checkout is actually enabled and every paid-launch gate has passed: “14 days free. Payment card required. Then renews at $29/month unless canceled.” Before paid launch, label the site according to the actual enabled pre-release stage: “Draft-only preview” when only `draft_only` workspaces are available, or “LinkedIn publishing beta” when the limited `publishing_beta` cohort is active. Describe each capability as unavailable only when its gate/configuration actually disables it; never imply that beta workspaces can publish if publishing is not enabled, or that all users can publish when only a limited cohort can.
4. Product preview using the actual built UI or clearly labeled demo data. No fabricated customer counts, testimonials, results or analytics.
5. Draft-only preview workflow: define voice and goals; review and refine generated drafts; export or copy drafts. Do not describe scheduling or publishing as available to `draft_only` workspaces, or Autopilot as available during any pre-release stage. Describe Telegram/MCP only if each gate has passed, the integration is enabled in the current build, and the copy accurately states the actions and entitlements available.
6. For a draft-only preview build, feature sections may focus on writing preferences, draft review and export. Hide any Telegram, MCP, publishing or Autopilot promotional section while that capability's own gate is pending or the integration is disabled. After Telegram or MCP passes its own gate and is enabled, the relevant section may be shown even in a pre-release build, with access restrictions stated accurately. Autopilot remains disabled during preview/beta and must not be marketed as available until the v1.0.0 paid-launch gate passes.
7. How permissions and publishing work.
8. Pricing is sourced from one server-side commercial configuration for the single Nunuza Solo plan at $29/month. Until paid-launch gates pass, the site must clearly identify the current release as the draft-only preview or, if applicable, the LinkedIn publishing beta, and keep checkout disabled. Never use “private beta” as a synonym for the public-signup draft-only preview. After paid-launch gates pass, show the approved price and trial terms accurately.
9. Stage-specific FAQ: the draft-only preview FAQ covers Google signup, draft-only limits, LinkedIn publishing availability, data handling and how to request updates. The LinkedIn publishing beta FAQ explains that publishing is limited to explicitly provisioned test-cohort workspaces and requires human approval. Show Telegram, MCP, Autopilot, publishing or paid-checkout FAQs only when the corresponding capability is enabled for the current stage, and describe cohort/entitlement restrictions accurately.
10. Final CTA and footer.

Homepage requirements:

- Responsive and fast; avoid unnecessary heavy animations.
- Every CTA has a real destination.
- “See how it works” scrolls to the workflow section or opens a real walkthrough.
- Header and pricing CTAs must use the correct launch-state flow: draft-only preview signup while live publishing or billing gates are blocked; the card-required checkout flow only after every paid-launch gate passes. Do not route all signups directly to checkout.
- SEO metadata must use Nunuza name and an accurate description. Do not claim features before implemented.
- Include basic analytics only after a privacy-conscious choice is configured; never block core use because analytics are unavailable.

# 6. Authentication, account and onboarding

## Authentication

- Supabase Auth with Google OAuth only. Do not add email/password or magic link.
- Same Google button supports signup and login.
- Configure allowed redirect URLs for local development, preview and production.
- Use secure server-side session handling compatible with the chosen Next.js/Cloudflare adapter.
- Protect all app routes on the server; client-side hiding is not authorization.
- Handle OAuth cancellation, invalid callback, expired session and provider errors with useful messages.
- Logout revokes the local session and returns to public homepage.
- Never treat Google login as LinkedIn connection. LinkedIn OAuth is separate.

## Onboarding steps

1. Welcome and concise explanation of Nunuza.
2. Professional profile: name/display name, role, company/venture, professional positioning, optional profile URL.
3. Audience: target roles/industries, audience problems and desired outcomes.
4. Content strategy: 3–5 content pillars, primary goal, prohibited topics, preferred stance and calls to action.
5. Voice profile: tone, sentence length, formality, words/phrases to use or avoid, sample writing supplied by the user if desired.
6. Cadence and schedule: target posts per week, preferred days/time and IANA time zone.
7. LinkedIn connection status and permission check. Explain that publishing is unavailable for `draft_only`, available only to explicitly provisioned `publishing_beta` workspaces after the beta gates pass, and available to paid entitlements only after their relevant release and billing gates pass.
8. The draft-only preview uses Approval Required automatically; operating-mode selection, scheduling and publishing controls are disabled. If the workspace is later explicitly provisioned into the LinkedIn publishing beta, it still uses Approval Required and may publish only human-approved drafts. Autopilot remains disabled.
9. If Telegram's end-to-end gate is pending or Telegram is disabled in the current pre-release configuration, show only a neutral status message such as “Integration not enabled” and let onboarding continue without it; do not expose linking or command controls. Once its gate passes and it is explicitly enabled, expose connection in the current build with the correct entitlement and action limits. Telegram must be enabled in v1.0.0 and is not deferred beyond that version.
10. No checkout or payment-card step in the draft-only preview or LinkedIn publishing beta. After paid-launch gates pass, the single Nunuza Solo checkout may be offered with clear card, renewal and cancellation disclosures.
11. Create the first plan and draft. Do not auto-publish during onboarding.

Store onboarding progress so a user can resume. Explain which steps block publishing. A disconnected LinkedIn account blocks publish jobs but should not destroy drafts.

# 7. Application information architecture and page requirements

Authenticated routes are the canonical v1 routes listed below. Implementation documentation may clarify or rename a route only if it preserves behavior and does not add an unapproved product flow; do not invent additional routes or capabilities.

- `/app/overview`
- `/app/content`
- `/app/calendar`
- `/app/strategy`
- `/app/voice`
- `/app/performance`
- `/app/activity`
- `/app/integrations`
- `/app/permissions`
- `/app/settings`
- `/app/billing`

## Overview

Show real data only:

- Agent state (operational status only): `setup_required`, `active_approval_required`, `active_autopilot`, `paused`, `blocked_integration` or `attention_required`. Show entitlement and billing status separately; never encode entitlement or subscription status in agent state.
- For `draft_only`, show the next draft/review task rather than a next scheduled post. For `publishing_beta` and paid entitlements with scheduling enabled, show the next scheduled post and its actual status. For `internal_test`, show only the designated acceptance-test status to authorized administrators.
- Drafts awaiting review.
- Recent completed/failed draft-generation jobs.
- LinkedIn connection status and publishing availability must reflect the actual entitlement and gates: publishing is unavailable for `draft_only`; limited human-approved publishing is available for a properly provisioned `publishing_beta` workspace only after its gates pass; paid publishing is available only with verified paid entitlement and all relevant gates.
- Show a release/entitlement-specific access badge: `draft_only` displays “Draft-only preview — no subscription required”; `publishing_beta` displays “LinkedIn publishing beta — no subscription required”; `internal_test` is visible only to authorized administrators as “Internal acceptance test”; `paid_trial`/`paid_active` display verified Polar status. Never infer agent state from the entitlement or entitlement from agent state.
- Primary action appropriate to state (finish setup, review draft, resolve connection, resume agent).
Do not show invented follower counts, impressions or success rates.

## Content

- For `draft_only`, tabs/filters are limited to All, Drafts and Needs Review; Scheduled and Published are not usable destinations. For `publishing_beta`, expose All, Drafts, Needs Review, Scheduled, Published and Failed only after LinkedIn publishing/scheduling and duplicate/reconciliation gates pass. For `internal_test`, show only the designated acceptance-test post and its reconciliation evidence to authorized administrators. For paid entitlements, expose the same publishing-state views only when the relevant capabilities are enabled. Gate visibility and server authorization together; hiding a tab is not an authorization control.
- Search and filters by status, date and content pillar.
- Each post card/row shows status and last update; show planned publish time only in a release where scheduling is enabled.
- Editor supports text-only post content, character count based on current LinkedIn constraints, draft title/internal notes, content pillar and source notes.
- For `draft_only`, allow save, revise, duplicate, request AI revision, review and export/copy; disable scheduling and publishing actions. For `publishing_beta`, allow schedule/publish actions only for explicitly provisioned workspaces after the LinkedIn and duplicate/reconciliation gates pass, with explicit human approval for each post. For `internal_test`, allow only the one restricted acceptance-test publishing flow. For paid entitlements, enable the applicable actions only after all relevant gates and verified Polar state pass.
- AI revision must preserve user intent and follow saved voice/boundaries. Show changed content before saving; never silently overwrite a human edit.
- Version history for content edits and approval transitions.
- A post cannot be published twice by duplicate queue delivery. A published post cannot be edited on LinkedIn through this product unless supported API access is explicitly implemented; local edits must not imply the published post changed.

## Calendar

- For `draft_only`, present a planning calendar for draft ideas only; do not present it as a live publishing schedule and do not expose schedule/reschedule/cancel controls. For `publishing_beta`, expose schedule/reschedule/cancel controls only after the LinkedIn publishing and duplicate/reconciliation gates pass, with human approval required for each post. The restricted `internal_test` workspace uses a separate acceptance-test flow, not the customer calendar.
- During the pre-release LinkedIn publishing beta, expose scheduling only to explicitly provisioned `publishing_beta` workspaces after the LinkedIn publishing and duplicate/reconciliation gates pass; require human approval for every post and keep Autopilot disabled. Telegram and MCP may be hidden only while their respective gates are pending; once each gate passes, it may be enabled in the current pre-release build, subject to entitlement and tool-level permissions. Both remain mandatory for v1.0.0 and must be enabled before v1.0.0 release completion.
- After scheduling is enabled for the relevant release, provide week and month views on desktop and a compact agenda/list view on mobile, with the user's time zone clearly displayed.
- Validate that scheduled time is in the future.
- Enforce the hard cap server-side: reject a second Nunuza-scheduled post for the same LinkedIn profile on the same calendar day, and reject any schedule that would exceed seven posts in a rolling seven-day period. The calendar must explain the rejection; a warning alone is insufficient.
- Warn about posts scheduled unusually close together without weakening the hard caps; do not silently change timing.
- Scheduling is not confirmation of publishing. Status must change only from recorded job results.

## Strategy

- Edit audience, business objective, content pillars, cadence, topic exclusions and preferred calls to action.
- “Regenerate plan” creates a new plan version and preserves the previous one.
- Explain why a proposed topic fits a selected pillar.
- Do not claim live web research unless an actual configured research source is used. If no research integration exists, the agent must label its suggestions as model-generated topic suggestions rather than researched facts.

## Voice profile

- Store explicit preference fields and optional user-provided writing samples.
- Let user preview a sample before saving.
- Never claim model fine-tuning. The v1 profile is structured preferences and examples injected into generation context.
- Allow users to delete supplied samples.
- Do not use one customer's content to improve another customer's outputs.

## Performance

- Show only metrics that are actually accessible for the connected member and approved API product/scopes.
- Distinguish “not available” from zero.
- Display source and last-sync time.
- If analytics scopes are unavailable, show publishing history and status instead of fabricated analytics.
- No outcome guarantees.

## Agent Activity

- List jobs with type, status, created time, start/end, attempt count, safe error summary and link to related content.
- Filters for queued, running, completed, failed, canceled and needs reconciliation. The UI label must be exactly “Needs reconciliation” and map to the canonical `needs_reconciliation` state.
- Allow retry only for retryable failures and only when idempotency rules make it safe.
- Do not expose secrets, access tokens, full provider payloads containing personal data, or internal stack traces to users.

## Integrations

- LinkedIn: during the draft-only preview, show connection/permission status and clearly state that publishing is unavailable. In the publishing beta and v1.0.0, show connected/disconnected state, granted scopes, token expiry/refresh state when known, last successful publish and reconnect action as applicable.
- Telegram: during any pre-release build, while the Telegram gate is pending or the integration is disabled, show only a neutral status message such as “Integration not enabled”; do not expose linking, unlinking or command controls. Once its gate passes and the integration is enabled, expose linked/unlinked state, unlink action, command controls and last successful interaction. It must be enabled in v1.0.0 and is not deferred to a post-v1.0.0 version. Every Telegram command remains subject to workspace entitlement and human-approval rules.
- MCP: during any pre-release build, while the MCP gate is pending or the integration is disabled, show only a neutral status message such as “Integration not enabled”; do not expose endpoint setup, connection instructions, credential creation, revoke or rotation actions. Once its gate passes and the integration is enabled, expose the endpoint URL, connection instructions, credential management, revoke/rotate action and last-used timestamp. It must be enabled in v1.0.0 and is not deferred to a post-v1.0.0 version. MCP tools always enforce the workspace entitlement and approval rules; `publishing_beta` is valid for human-approved scheduling/publishing only after both MCP and LinkedIn gates pass.
- Show required permission and data access plainly before enabling any connection.
- Disconnecting an enabled integration prevents future use; safely cancel or mark affected jobs and explain what happened.

## Permissions

- Operating mode: Approval Required by default. The draft-only preview and LinkedIn publishing beta expose Approval Required only; Autopilot controls remain disabled in both stages. The publishing beta permits human-approved publishing only for explicitly provisioned `publishing_beta` workspaces after approved LinkedIn access and a successful end-to-end test publish.
- Authorized Autopilot is part of v1.0.0 scope, but is disabled during pre-release preview/beta stages. Enable it for the v1.0.0 paid launch only with a valid paid publishing entitlement, all publishing and Autopilot release gates passed, explicit user confirmation and a summary of permitted actions.
- User can choose lower daily/weekly posting limits, allowed content pillars, prohibited topics, allowed CTA styles, and quiet hours. The hard product caps remain one scheduled post per calendar day and seven per rolling seven-day period; users cannot raise them.
- Pausing blocks new jobs and prevents not-yet-started publish actions. In-flight operations must be reconciled; never claim a post was stopped if the LinkedIn API already accepted it.
- Any change to autonomy or publish permissions creates an audit event.

## Settings

- Profile display details, time zone, notification preferences, security/session controls, export data, delete account.
- Deletion requires confirmation and a clear explanation of data removal and billing consequences.
- Never delete content or external account authorization silently.

## Billing

- For `draft_only`, show “Draft-only preview — no subscription required”; for `publishing_beta`, show “LinkedIn publishing beta — no subscription required.” Both must clearly state that checkout is unavailable and must not show an active Nunuza Solo subscription, trial, next billing date or cancellation action for a subscription that does not exist. Show “Internal acceptance test” only to authorized administrators for `internal_test`. For `paid_trial`/`paid_active`, show only verified Polar subscription/trial details and a cancellation action when a real subscription exists.
- After paid launch is enabled, show the active Nunuza Solo subscription (the only v1 plan), trial start/end where applicable, next billing date/amount, subscription status and cancellation/manage-subscription action.
- Paid state comes from verified server-side Polar data, not client parameters.
- Provide a clear cancel path only when a real subscription exists.
- Access rules must distinguish trialing, active, past_due, canceled, expired and unpaid/blocked states.
- Export of user-owned drafts, published-post records, content versions and user settings must remain available regardless of trial/subscription status, including after expiration or cancellation. Apply only legally required retention restrictions, and document any excluded provider-owned data clearly.

# 8. Agent operating model

## Core principle

The agent is an asynchronous, persisted workflow system, not a single prompt or an infinite loop. Each unit of work is a durable job with status, checkpoints, attempts, timestamps and audit events. It continues independently of browser, Telegram or Claude sessions.

## Agent state

Workspace agent states (operational status only; these are not access entitlements):

- `setup_required`
- `active_approval_required`
- `active_autopilot`
- `paused`
- `blocked_integration`
- `attention_required`

Billing/subscription status belongs to the billing records and `entitlement_type`, not the agent-state field. An inactive paid entitlement blocks paid jobs/publishing but does not block separately permitted `draft_only` drafting/export or a valid `publishing_beta` entitlement. The agent-state enum must never include entitlement values such as `draft_only`, `internal_test` or `publishing_beta`.

Job states:

- `queued`
- `running`
- `waiting_for_approval`
- `succeeded`
- `failed_retryable`
- `failed_terminal`
- `canceled`
- `needs_reconciliation`

Every agent-state transition must be validated server-side and recorded. Use explicit enums/unions, not free-form status strings. The server-side `entitlement_type` is the sole authority for feature permissions; agent `state` must never grant or revoke access. If state and entitlement appear inconsistent, entitlement checks still govern authorization, the operation fails closed where the agent state is unsafe (for example, paused/blocked), and the inconsistency is logged for repair.

## Scheduled operating cycle

1. Scheduler checks due workspaces and creates idempotent jobs.
2. Worker claims a job with a lock/lease and records an attempt.
3. Worker checks server-side `entitlement_type` as the sole authority for feature permissions, plus integration status, user permissions, quiet hours, posting limits and current agent state as safety conditions. `draft_only` permits planning, drafting, editing, review and export only, never scheduling or publishing. `internal_test` permits only the designated internal acceptance-test publish after confirmed LinkedIn product/scope approval AND successful automated duplicate/idempotency tests, followed by authorized administrator provisioning; it cannot be assigned through public signup or to customer workspaces and is revoked after acceptance. `publishing_beta` permits limited LinkedIn scheduling/publishing only for explicitly provisioned test-cohort workspaces after the internal real test publish, verified LinkedIn access and duplicate/reconciliation acceptance; explicit human approval is required for each post and no Polar subscription is required. Telegram and MCP may be hidden from customer workspaces in a pre-release build only while their respective gates are pending or the release configuration explicitly keeps them disabled. Once an integration is enabled, its server-side authorization and each workspace's entitlement still govern every action. Both are mandatory v1.0.0 capabilities and must be enabled before v1.0.0 release completion. `paid_trial`/`paid_active` permit the v1.0.0 capabilities enabled for the release only when corresponding verified Polar state, LinkedIn permissions and every capability-specific release gate are valid.
4. Agent creates or updates a content plan/draft using stored strategy and voice context.
5. Validate content against length/format rules, prohibited topics, duplicates and user-defined constraints.
6. In Approval Required mode, save the draft and transition to waiting_for_approval; notify the dashboard and only those additional channels that are enabled and end-to-end verified.
7. Autopilot processing is part of v1.0.0 but is disabled in the preview and publishing beta. Enable it for the v1.0.0 paid launch only after approved LinkedIn publishing access, a successful end-to-end test publish, all Autopilot-specific release gates and a valid paid publishing entitlement are recorded. This Autopilot rule does not disable the separate human-approved `publishing_beta` path described above. When Autopilot is enabled, validate each post against the exact configured authorization; if ambiguous or outside boundaries, require human approval.
8. At publish time, re-check the server-side entitlement: `draft_only` must always be rejected; `internal_test` may publish only the designated acceptance-test post from the administrator-provisioned internal test workspace after LinkedIn product/scope approval and successful automated duplicate/idempotency tests; `publishing_beta` is allowed only for an explicitly provisioned test-cohort workspace with human approval for that exact draft and all LinkedIn beta gates passed; `paid_trial`/`paid_active` require valid verified Polar state and all relevant v1.0.0 gates. In every case, LinkedIn permission/token, schedule, hard limits, duplicate key and account state must be valid. Reject Autopilot during preview/beta. For Telegram and MCP, reject actions whenever the integration is not enabled or its own gate has not passed; when enabled in a pre-release build or v1.0.0, enforce the workspace entitlement, human-approval requirements, tool-specific permissions and integration authorization. Do not treat the preview/beta label itself as a blanket authorization or rejection rule.
9. Call official LinkedIn API and record request correlation data and the actual outcome. Do not mark success based only on queue execution.
10. Notify the user and record a sanitized audit event.
11. Update next-run time and schedule the next cycle.

## Content generation quality

- Use a structured generation request containing audience, goal, content pillar, voice preferences, constraints, recent post history and desired CTA.
- Generate a small set of candidates only when needed; choose based on relevance, clarity, specificity, factual caution and repetition checks.
- Do not invent personal experiences, customer stories, statistics, quotes or credentials for the user.
- Flag claims requiring verification. Avoid unsupported factual claims and fabricated sources.
- Never publish content involving sensitive, regulated or potentially harmful claims outside the user's explicitly allowed scope; route uncertain content for approval.
- Avoid repetitive hooks and recycled wording by comparing recent posts.
- Store prompt/model version and provider metadata for debugging, but do not expose secrets or unnecessary sensitive prompt content in logs.
- AI provider failure must not lose the job; retry within bounded limits and use fallback only if configured and available.

## Pause, resume and cancellation semantics

- Pause is immediate for new scheduling and work claims.
- Before any external publish call, re-check the pause flag and authorization.
- If the publish request is already in flight, reconcile the API result. Do not claim cancellation if it may have succeeded.
- Resume re-enables future jobs only after rechecking entitlement and integrations.
- User cancellation and admin/system cancellation are distinct audit reasons.

# 9. LinkedIn integration

- Use official LinkedIn OAuth and supported APIs only.
- Request only scopes required for the feature actually being used. Do not assume permissions.
- Posting permission, typically the relevant member social posting scope and required developer product access, must be confirmed in the actual developer app before the integration is declared complete.
- Analytics, organization/page publishing and broader management may require separate scopes/program approval. Treat them as unavailable until confirmed.
- Store OAuth tokens encrypted server-side; never send tokens to the browser, Telegram messages or MCP tool outputs.
- Validate OAuth state, redirect URI and account/workspace association. Handle revoked access and refresh expiry.
- Build a capability check at connection time and display the actual available capabilities.
- v1.0.0 publishing supports text-only posts unless a later approved change explicitly adds media.
- Use provider request identifiers and local idempotency keys. On ambiguous timeout after publish request, reconcile if API capabilities permit before retrying, to avoid duplicate posts.
- Capture rate limits and provider errors, retry only safe transient failures, and show actionable errors for permanent failures.
- Do not scrape LinkedIn for research or analytics. If no compliant research source is implemented, use model-based ideation and clearly label it accordingly.
- Acceptance test: connect a real test account, create a text draft, publish one authorized test post, confirm API success and persist a matching record. If access is blocked, document the blocker and do not claim this integration works.

# 10. Telegram integration

- Telegram is a real conversational control interface, not just a notification channel.
- Link account via bot deep link with a cryptographically random, short-lived, single-use token stored hashed server-side. Token must map to a specific authenticated user/workspace. Never rely on a username as proof of identity.
- Validate Telegram webhook secret token and request integrity according to Bot API capabilities.
- Store Telegram numeric user ID and chat ID after successful link. Do not ask users to manually find/paste IDs.
- Support initial command set:
    - `/start`: help and secure account-link flow
    - `/status`: agent, integration, trial and next-post status
    - `/pause`: pause autonomous work
    - `/resume`: resume after checks
    - `/drafts`: list drafts needing review
    - `/approve <draft-id>`: approve a specific draft when policy allows
    - `/reject <draft-id>`: reject a draft and optionally collect feedback
    - `/report`: recent activity and available performance summary
    - `/help`: commands and explanation
- Natural language requests may create drafts, revise drafts, explain status or change allowed settings. For consequential or ambiguous actions, ask a clarifying question or require confirmation.
- Telegram cannot bypass Approval Required mode. Approval actions require a specific draft ID and a clear confirmation response.
- Enforce tenant ownership on every Telegram action.
- Rate-limit commands, deduplicate webhook updates and record audit events.
- If Telegram is unavailable, the dashboard remains functional. Queue notifications for bounded retry; never block core publishing only because a notification failed.

# 11. Remote MCP integration

- Ship a remote MCP server in v1.0.0. Use a supported, maintained TypeScript MCP SDK and a transport compatible with target clients; document tested clients and protocol versions.
- MCP calls are authenticated, tenant-scoped and permission-checked on the server. No global shared secret for all customers.
- Use exactly one active MCP credential set per workspace for v1, implemented with the secure credential/token mechanism supported by the chosen remote MCP transport and client. Rotation revokes the previous set; credentials are revocable, workspace-scoped and never expose service-role secrets. Do not create parallel active credential sets for the same workspace.
- MCP tools must call the same domain services as the dashboard and Telegram. No duplicated business logic and no permission bypass.
- Initial read tools: `get_agent_status`, `get_content_plan`, `list_drafts`, `get_publishing_schedule`, `get_performance_summary`, `list_recent_activity`.
- Remote MCP is a required v1.0.0 integration. Implement and expose its permitted tools as soon as the MCP authentication/security gate passes; preview/beta builds may hide the integration while that gate is pending, but it must not be deferred beyond v1.0.0. Initial draft/control tools are `create_draft`, `edit_draft`, `request_draft_revision`, `reject_draft`, `pause_agent` and `resume_agent`. Expose read tools listed above when MCP passes its gate. Expose `schedule_post` and `cancel_scheduled_post` only after MCP and LinkedIn scheduling/publishing gates pass and the workspace has a valid publishing entitlement. `publishing_beta` is a valid publishing entitlement for these two tools after its internal test, LinkedIn, duplicate/reconciliation and MCP gates pass, but it still requires explicit human approval for the exact draft; `internal_test` may use only the restricted acceptance-test flow. A schedule request may proceed only for a draft already approved by an authenticated human through the web app or a verified Telegram integration, or under a separately configured and explicitly enabled Autopilot policy for a paid entitlement. Do NOT expose an `approve_draft` MCP tool in v1.0.0; MCP clients and AI agents cannot approve their own drafts or supply the human approval required to publish.
- Every tool has a strict input schema, typed result, documented error codes, workspace scope, required permission and audit event.
- The server must reject requests that target another tenant's IDs, request unapproved publishing, exceed limits, operate without the job-appropriate server-side entitlement, operate on an expired subscription where paid entitlements are required, or use revoked credentials. `publishing_beta` is a valid entitlement for human-approved LinkedIn scheduling/publishing via MCP only after the MCP and LinkedIn gates pass; it never authorizes Autopilot, and it does not bypass an integration's own gate. `internal_test` authorizes only the designated acceptance-test publish and is never a general customer publishing entitlement.
- Approval must be an explicit action by the authenticated human in the web app or Telegram. An MCP request, AI-generated tool call, schedule request, or previous approval of another version is not approval. Any material edit after approval invalidates that approval and requires a new human approval. Autopilot is a separate, explicit workspace-level permission with its own bounded policy; MCP cannot enable or expand it.
- Never publish merely because an MCP client asks to. Approval Required mode and configured autopilot boundaries still apply.
- Return minimal data needed for the task. Never return access tokens, billing payment details or other customers' information.
- Acceptance test: a test MCP client can authenticate, list its own drafts, create a draft, pause the agent, and is denied access to another workspace and to unauthorized publishing; schema/tool discovery contains no approve_draft tool.

# 12. Polar billing and trial

- Polar is the merchant/billing integration. Product/price IDs and webhook secrets are server-side environment variables.
- Do not hard-code Polar product/price IDs in UI. Maintain a server-side mapping for the single Nunuza Solo plan and its entitlements, referencing the verified Polar product/price IDs.
- v1 has exactly one commercial plan: Nunuza Solo at USD $29/month. Once all paid-launch gates pass, the trial lasts 14 days, requires a payment method at signup, and converts to $29/month unless canceled; display the recurring amount, first charge date and cancellation path before checkout confirmation.
- During trial, grant only the Nunuza Solo entitlements defined in the binding pricing decision. Do not implement plan selection, multiple tiers, add-ons, annual billing or a generic multi-plan catalog in v1.
- Trial activation is confirmed by verified Polar webhook/server state, not by redirect query parameters.
- Verify webhook signatures and process events idempotently. Store event IDs and processing outcomes.
- Handle trialing, active, past_due, canceled, revoked/unpaid, expired and refund/dispute states explicitly.
- Cancellation during trial: access remains through the trial end if Polar state confirms that behavior; no renewal charge after cancellation. Confirm exact Polar configuration during integration tests.
- Paid cancellation: access remains through the paid-through period unless provider state or fraud/suspension requires otherwise.
- Failed payment: use Polar's supported recovery process; show clear state and allow content export. Do not repeatedly charge independently.
- Show the exact recurring amount, currency, billing frequency, first charge date and cancellation method before checkout confirmation.
- Test webhooks with replay protection and duplicate/out-of-order event scenarios.

# 13. Nunuza Solo plan and entitlements

The v1 commercial offer is fixed; pricing and plan count are NOT open decisions.

- One plan only: Nunuza Solo — USD $29/month.
- Trial after paid-launch gates pass: 14 days, payment card required, then $29/month unless canceled.
- Entitlements and limits are defined in binding execution decision BED-02 at the top of this document: one user/workspace, one personal LinkedIn account, one active strategy, up to 30 new workflow items per paid billing period or per UTC calendar month for no-subscription `draft_only`/`publishing_beta` workspaces, at most one scheduled post per calendar day and seven per rolling seven-day period, one Telegram account, and one MCP credential set.
- Do not implement multiple plans, a plan selector, annual billing, add-ons, coupons, overages or extra tiers in v1.
- Analytics are limited to data actually available through approved LinkedIn API access; operational workflow metrics are not represented as LinkedIn performance metrics.
- Billing integration development must use provider sandbox/test products only. Local application data or unavailable integrations may use visibly labeled test fixtures, but fixtures must never be presented as live or count as release acceptance. Live checkout stays disabled until seller eligibility, provider onboarding and IDs, legal disclosures, webhook verification, LinkedIn publishing access and all release gates pass. Validate the single Nunuza Solo billing configuration before enabling paid checkout and fail closed for live billing if required Polar configuration is missing. Missing live Polar configuration must not prevent the draft-only preview from starting; label billing unavailable and keep checkout disabled.

# 14. Technical architecture

## Components

- Web app: Next.js + TypeScript, deployed using a Cloudflare-compatible adapter after verifying supported Next.js features.
- API/domain layer: TypeScript server-side modules; shared service functions for web, Telegram and MCP.
- Background jobs: Cloudflare Queues consumer with small, bounded, resumable handlers.
- Scheduling: Cron Triggers enqueue due-work checks; do not rely on one long-running request or an infinite loop.
- Data: Supabase PostgreSQL. Define migrations in version control and apply through a repeatable migration process.
- Auth: Supabase Auth with Google OAuth.
- Do not fabricate or dynamically invent prices. The v1 price is fixed at $29/month for Nunuza Solo. Live checkout stays disabled until the single Polar product/price configuration, legally eligible seller onboarding, legal copy and webhook configuration are verified, along with all other paid-launch gates.
- AI: provider interface for Groq/OpenRouter, server-only secrets, configurable models and bounded timeouts.
- Integrations: LinkedIn OAuth/API, Telegram Bot API, Polar webhooks, MCP server.
- Observability: structured, redacted logs; correlation IDs; job attempt history; error monitoring choice to be configured.
- Secrets: Cloudflare secrets/environment bindings and Supabase server-side secrets; never commit secrets or expose them to client bundles.
- Storage: no object storage required for text-only v1.0.0 beyond provider needs. If later added, tenant-scope files and validate uploads.

## Important deployment caveats

- Verify Next.js adapter compatibility, routing, auth cookies, streaming needs and scheduled execution in a small spike before building all screens.
- Cloudflare Workers are event-driven; never assume a worker can run indefinitely. Split work into durable jobs with checkpoints.
- Supabase free tier may pause inactive projects and is not a production reliability guarantee. Confirm current plan limits before launch.
- Free services and free model tiers have quotas and can change. Provide usage limits, provider fallback, graceful quota errors and a visible development/production environment split.
- The project budget target is $0 at development start. Do not activate paid services or incur spend without founder approval. A dependable commercial launch may require some paid infrastructure.

# 15. Data model

Use UUID primary keys, UTC timestamps, foreign keys, explicit enums, appropriate indexes, and migrations. Every tenant-owned row includes `workspace_id` (or a provably equivalent owner scope). Enforce Row Level Security in PostgreSQL for browser-accessible data and enforce tenant authorization in server services as well.

Required entities/tables:

1. `profiles`: `id` (Supabase auth user ID), display name, avatar URL if supplied, timezone, created_at, updated_at.
2. `workspaces`: id, owner_user_id, name, `state` (agent operational status only), `entitlement_type` enum (`draft_only`, `internal_test`, `publishing_beta`, `paid_trial`, `paid_active`, `inactive`), operating_mode, paused_at, created_at, updated_at. The server-side `entitlement_type` is the sole authority for feature permissions. Public signup receives `draft_only`; only after LinkedIn product/scope approval AND successful automated duplicate/idempotency tests may an authorized administrator provision `internal_test` to a designated internal acceptance-test workspace. Only explicitly selected test-cohort workspaces may receive `publishing_beta` after the internal real test publish and LinkedIn/duplicate-reconciliation acceptance; `paid_trial`/`paid_active` are set only from verified Polar state. The agent `state` field must contain operational status only, never `draft_only` or any other entitlement value. If state and entitlement disagree, entitlement remains the permission authority while unsafe operational states such as paused/blocked still prevent execution. `draft_only` permits drafting/review/export only; `internal_test` permits only the restricted internal acceptance-test publish and is automatically changed to `draft_only` immediately after acceptance, removing all test-publish permission; this does not automatically grant `publishing_beta`; `publishing_beta` permits limited human-approved LinkedIn scheduling/publishing without a subscription; paid entitlements permit the v1.0.0 capabilities whose gates have passed. `inactive` permits read/export/cancellation access but no new paid jobs or publishing. v1.0.0 supports one owner per workspace; no team seats.
3. `workspace_members`: optional minimal table reserved for future-proofing; v1.0.0 must not expose team invites or multi-user access.
4. `integration_connections`: id, workspace_id, provider enum (linkedin/telegram/polar/mcp as applicable), external account ID, encrypted token/credential reference, granted scopes, status, expires_at, metadata allowlist, connected_at, disconnected_at. Never store secrets in client-readable columns.
5. `voice_profiles`: id, workspace_id, structured voice settings, sample text reference/content, exclusions, version, updated_at.
6. `content_strategies`: id, workspace_id, audience, goals, pillars JSON, cadence, preferred days/times, timezone, exclusions, CTA preferences, version, created_at.
7. `content_plans`: id, workspace_id, strategy_version, period_start/end, status, plan JSON, created_at, superseded_at.
8. `content_posts`: id, workspace_id, plan_id nullable, text, internal_title nullable, pillar, source_notes, status enum, scheduled_at nullable, published_at nullable, linkedin_post_id nullable, version, created_by, created_at, updated_at.
9. `content_post_versions`: id, workspace_id, post_id, version_number, text, change_source, changed_by nullable, created_at.
10. `approval_events`: id, workspace_id, post_id, actor_type, actor_id nullable, action, reason nullable, created_at.
11. `agent_jobs`: id, workspace_id, job_type, status, idempotency_key unique within scope, payload with validated non-secret data, scheduled_for, started_at, finished_at, attempt_count, max_attempts, lease_until, correlation_id, last_error_code, safe_error_message, created_at, updated_at.
12. `agent_job_attempts`: id, workspace_id, job_id, attempt_number, started_at, finished_at, outcome, provider, model, provider_request_id nullable, safe_error_code, duration_ms.
13. `audit_events`: id, workspace_id, actor_type, actor_id nullable, action, resource_type, resource_id nullable, safe_metadata JSON, created_at.
14. `telegram_links`: id, workspace_id, telegram_user_id, chat_id, linked_at, last_interaction_at, revoked_at; unique active link constraints.
15. `link_tokens`: id, user_id, workspace_id, token_hash, expires_at, consumed_at, created_at.
16. `mcp_credentials` or equivalent auth grants: id, workspace_id, user_id, token hash/reference or OAuth grant metadata, scopes, expires_at, revoked_at, last_used_at, created_at. Never store raw reusable tokens if a hash-based design suffices.
17. `billing_customers`: workspace_id, polar_customer_id, created_at.
18. `subscriptions`: workspace_id, polar_subscription_id, product_id, price_id, status, trial_start/end, current_period_start/end, cancel_at_period_end, entitlement_snapshot, updated_at.
19. `billing_webhook_events`: provider_event_id unique, type, received_at, processed_at, processing_status, safe_error_code.
20. `usage_counters`: workspace_id, metric, period_start/end, count; transactionally enforce limits where needed.

Add indexes for workspace_id, job status/scheduled_for, post status/scheduled_at, subscription status, external post IDs and webhook event IDs. Use database constraints to prevent invalid state combinations. Define cascade/delete behavior intentionally. Do not store whole OAuth responses or raw provider payloads unless a specific need is documented.

# 16. API and service contracts

- Use typed request/response schemas and runtime validation for all external inputs.
- All domain operations accept an authenticated actor and workspace scope; never accept workspace ID from a client without verifying membership/ownership.
- Shared domain services: content service, schedule service, agent control service, integration service, billing/entitlement service, MCP authorization service.
- API errors use stable codes such as `AUTH_REQUIRED`, `FORBIDDEN`, `SUBSCRIPTION_INACTIVE`, `INTEGRATION_NOT_CONNECTED`, `LINKEDIN_SCOPE_MISSING`, `APPROVAL_REQUIRED`, `RATE_LIMITED`, `DUPLICATE_ACTION`, `VALIDATION_ERROR`, `PROVIDER_UNAVAILABLE` and `INTERNAL_ERROR`.
- Return a correlation ID with errors. User-visible messages are actionable; logs contain redacted technical context.
- All mutating operations must be idempotent where feasible and auditable.
- Do not expose raw provider errors, stack traces, OAuth tokens or webhook secrets to the browser.

# 17. Security and privacy requirements

- Tenant isolation is a release blocker. Add tests that attempt cross-workspace reads/writes for every tenant-owned entity.
- Enable and test Supabase Row Level Security on all tables accessible through user-scoped clients.
- Server service-role credentials must never be used in the browser.
- Encrypt OAuth tokens and integration secrets at rest using a documented key-management approach. If encryption cannot be implemented correctly for v1.0.0, do not store the token in plaintext; use an appropriate managed secret strategy or block that integration.
- Verify OAuth state and redirect URI; use least-privilege scopes.
- Verify Polar webhook signatures and deduplicate event IDs.
- Validate Telegram webhook secret and deduplicate update IDs.
- MCP authentication is revocable, scoped and audited.
- Rate-limit auth callbacks, AI generation, webhook actions, MCP tools and Telegram commands.
- Sanitize and bound all user-supplied text; guard against prompt injection in imported/user-provided content. Content from outside sources is data, not instructions to override system policy.
- Logs must not contain access tokens, passwords, payment data or full sensitive prompts by default.
- Provide account export and deletion flows with clearly documented retention behavior. Keep billing records only as required by configured legal/accounting policy; do not claim a retention period until decided.
- Add basic abuse controls for trial signup and costly AI job execution.
- Respect provider terms and LinkedIn API limits. Do not promise access to data/scopes that have not been granted.

# 18. Reliability, retries and idempotency

- Queue jobs are at-least-once; consumers must be idempotent.
- Use database-backed idempotency keys for schedule creation, approval and publishing.
- Claim jobs transactionally or via a safe lease/lock pattern. Expired leases can be recovered.
- Retry transient network/provider/429/5xx errors with exponential backoff and jitter, bounded attempt count, and provider Retry-After where available.
- Do not automatically retry permanent validation/auth/permission errors without user action.
- A timeout after a LinkedIn publish request is ambiguous. Reconcile against provider-supported identifiers before retry; if reconciliation is impossible, persist the canonical job state `needs_reconciliation` and surface the exact UI label “Needs reconciliation” rather than risking a duplicate.
- Dead-letter or terminally fail jobs after configured attempts; show the user a safe error and next action.
- A notification failure does not reverse a successful post.
- Scheduled tasks must be stored durably in the database; Cron is only a wake-up mechanism.
- Every job records created/started/finished times, attempts and final outcome.

# 19. Notifications

- In-app status is authoritative.
- Telegram notifications are sent for draft ready, approval needed, post scheduled, publish success/failure, agent paused/resumed, integration disconnected and billing state changes.
- Avoid noisy notifications; group routine activity where possible.
- Notification failure is retried within bounds and logged.
- Never include access tokens or sensitive billing details in messages.
- Respect notification preferences and quiet hours, except essential security/billing notices where configured.

# 20. Testing and acceptance criteria

## Automated tests

- Unit tests: state transitions, entitlement checks, schedule validation, duplicate detection, content limits, permissions, token expiry and webhook signature validation.
- Integration tests: Supabase migrations/RLS, queue consumer, AI provider abstraction, LinkedIn adapter with mocks, Telegram linking, MCP authorization and Polar webhooks.
- End-to-end tests: signup/login, onboarding, draft creation/editing, approval flow, schedule, pause/resume, trial state, cancellation UI and mobile navigation.
- Security tests: cross-tenant IDOR attempts, revoked credentials, replayed webhooks, expired tokens, unapproved publish attempts, MCP scope violations.
- Responsive tests: 320, 375, 390, 768, 1024 and 1440 widths.
- Accessibility: keyboard navigation, visible focus, labels, dialog focus handling, contrast and screen-reader names.

## Release acceptance criteria

Acceptance is stage-specific and must be evaluated using the explicit checklists below. A pre-release stage is complete only when every criterion for that stage passes; capabilities with pending gates remain safely disabled, and that stage must not be described as v1.0.0. The numbered criteria 1–18 below are the v1.0.0 release checklist only; v1.0.0 is release-complete only when all 18 criteria and every mandatory BED-10 gate, including the dedicated Autopilot gate, pass. No capability or gate required by the v1.0.0 scope may be waived as “not applicable.”

### Draft-only preview acceptance criteria

All of the following are required to accept the limited draft-only preview:

- [ ]  The required runtime/deployment spike and Google sign-in, protected-route, session and tenant-isolation checks for the preview pass.
- [ ]  Public Google signup creates a server-authorized `draft_only` workspace without checkout, a payment card, invitation, or paid entitlement.
- [ ]  A user can complete/resume onboarding, create/edit/revise/review and export/copy a text draft; version history is preserved.
- [ ]  Server-side authorization rejects scheduling, publishing and Autopilot for `draft_only`, regardless of UI visibility or requests from integrations.
- [ ]  Telegram/MCP setup and control surfaces remain hidden while each respective gate is pending or integration disabled; if a neutral status message is shown, it is stage-neutral and provides no actionable controls. An integration whose gate passes may be enabled in the pre-release build with correct authorization.
- [ ]  No fake integrations, fabricated metrics, dead primary CTAs or unsupported publishing claims; responsive, accessibility and security checks required for the preview pass.

### LinkedIn publishing beta acceptance criteria

All draft-only preview foundation criteria remain required, plus all of the following before customer-facing beta publishing is enabled:

- [ ]  LinkedIn product/scope approval is evidenced and automated duplicate/idempotency tests pass before an authorized administrator grants `internal_test` to the designated internal test workspace.
- [ ]  The restricted real acceptance-test post succeeds and is reconciled with its returned LinkedIn post identifier and duplicate-safety evidence; `internal_test` is then revoked/demoted to `draft_only` and does not automatically grant customer beta access.
- [ ]  Only explicitly selected and provisioned test-cohort workspaces receive `publishing_beta`; each post requires explicit human approval, and schedule caps, idempotency, timeout/reconciliation, pause and failure handling are enforced.
- [ ]  Beta signup/workspaces remain no-charge and are not represented as having a paid subscription or trial; Autopilot stays disabled.
- [ ]  Telegram and MCP remain individually gate-controlled: no actionable setup/control surfaces while a gate is pending; after each gate passes, the integration may be enabled with its own entitlement and permission checks.

### v1.0.0 release acceptance criteria

1. Brand assets exist and all UI surfaces use the approved logo and spelling.
2. Google signup/login/logout and session refresh work in supported environments.
3. User can complete onboarding and resume it after leaving.
4. User can create/edit/save a text draft and view version history.
5. Approval Required mode cannot publish without an explicit valid approval.
6. Autopilot cannot exceed configured permissions or posting limits.
7. Scheduled jobs execute without an open browser and recover after worker interruption.
8. Before v1.0.0 release completion, an authorized test LinkedIn account has successfully published a real text post and the resulting post URN/outcome has been reconciled with duplicate-safety evidence. If access or permission is pending/denied, mark live publishing BLOCKED and continue only the explicitly limited pre-release stage; v1.0.0 cannot be marked complete or launched.
9. Duplicate queue delivery cannot create duplicate posts.
10. Telegram linking is secure; allowed commands work and unauthorized account access fails.
11. Remote MCP client can authenticate and use permitted tools; cross-tenant and unapproved publish attempts are rejected.
12. Polar webhooks correctly grant/revoke trial and subscription entitlements and are idempotent.
13. Trial and renewal terms are visible before checkout; live checkout remains disabled until seller eligibility, approved price/product configuration, legal disclosures and Polar acceptance tests pass. If these requirements remain blocked, checkout stays disabled in pre-release and v1.0.0 paid launch remains BLOCKED.
14. Every customer-owned record is tenant-isolated and tested.
15. Dashboard and marketing pages pass responsive tests with no page-level horizontal overflow.
16. No fabricated metrics, fake testimonials, placeholder branding or dead primary CTAs remain.
17. Production build, lint, typecheck, tests and migrations pass.
18. Environment setup and deployment/rollback steps are documented.

# 21. Antigravity execution protocol

Antigravity must follow this sequence. Do not build the entire product in one uncontrolled pass.

## Phase 0: Inspect and report

- Inspect repository, existing code, package manager and current instructions.
- Create `/docs/PRODUCT_SPEC.md` containing this specification and `/docs/BRAND.md` for approved brand assets/tokens.
- Return a short implementation plan, identified risks and any true blockers.
- Do not replace existing files blindly. Do not invent a name, logo, prices, API scopes, metrics or secrets.
- Validate Cloudflare/Next.js adapter compatibility and create a minimal deployment spike before building the whole app.
- In parallel, start the LinkedIn access feasibility spike immediately: verify developer app product/scope eligibility, OAuth flow, actual member-posting permissions, API version and approval requirements. Record evidence in `/docs/evidence/linkedin-access.md`; do not defer this check to Phase 4.

## Phase 1: Foundation and brand

- Establish TypeScript, linting, formatting, environment validation, theme tokens, responsive layout and approved logo assets.
- Create reusable UI primitives and navigation.
- Add a polished homepage and responsive auth screens.
- Ensure no broken routes or fake functionality.

## Phase 2: Auth, database and onboarding

- Add migrations, RLS policies, seed/development data, Google OAuth and onboarding persistence.
- Add tenant-isolation tests before adding real integrations.

## Phase 3: Content workflow

- Build strategy, voice profile, draft editor, versions, review flow and draft-planning calendar using domain services. During the draft-only preview, do not expose live scheduling, publishing or Scheduled/Published tabs.
- Use clearly labeled local fixtures for unavailable integrations or seeded development data; do not confuse mock data with live data. Billing integration tests must use provider sandbox/test products, not local fixtures presented as billing-provider behavior.

## Phase 4: Integrations

- Implement the complete required v1.0.0 LinkedIn OAuth and publishing integration using the access feasibility evidence collected during Phase 0; do not defer the access check to this phase. If approval is pending/denied, keep the integration and safe UI implemented behind a server-side disabled gate, mark live publishing BLOCKED, and record the external dependency. Do not enable or market it until the real end-to-end publish and reconciliation acceptance test passes; v1.0.0 remains blocked meanwhile.
- Implement secure Telegram linking and command handling as required v1.0.0 scope. It may be hidden in preview/beta builds while its gate is pending, but must pass its end-to-end gate and be enabled before v1.0.0 is release-complete.
- Implement remote MCP authentication, tool schemas and permission checks as required v1.0.0 scope. It may be hidden in preview/beta builds while its gate is pending, but must pass its end-to-end gate and be enabled before v1.0.0 is release-complete.
- Implement Polar webhooks and trial state; keep live checkout disabled until seller eligibility, provider configuration and all release gates pass.

## Phase 5: Background agent

- Add queue consumers, scheduled wake-ups, durable job state, retry/lease/idempotency logic, notifications and pause/resume.
- Test with provider mocks and a real authorized LinkedIn test post where access permits.

## Phase 6: Hardening and release

- Finish analytics only for available data.
- Complete responsive/accessibility/security tests.
- Validate environment configuration, billing settings, logging, migration and rollback procedures.
- Produce a completion report mapping each acceptance criterion to PASS, FAIL or BLOCKED with evidence.

## Mandatory implementation rules

- Work in small, verifiable increments and keep the application runnable.
- Do not claim an integration works without a successful test.
- Do not silently substitute a mock for a real integration.
- Do not hard-code secrets, public prices or unverified API scopes.
- Do not introduce unapproved frameworks or extra providers without a documented reason.
- If an external approval or account credential blocks a feature, continue implementing the required v1.0.0 integration and surrounding interface safely behind server-side authorization, mark the unavailable live capability BLOCKED, and report exactly what is needed. Never enable or market an unverified capability. A blocked required capability may permit a limited pre-release stage but always blocks v1.0.0 release completion.
- Every feature must include loading, empty, success and error states.
- Use actual icons and accessible labels, not emoji placeholders.
- Use real responsive layouts, not desktop-only pages that shrink.
- Keep a `/docs/DECISIONS.md` log for changes to the specification. Any scope change must be proposed with impact before implementation.
- There is no fixed seven-day deadline and no attempt to acquire a paying customer before the required gates. Start customer interviews in parallel with Phase 0 and continue them during implementation; complete at least 10 interviews (target 15) and recruit 5–10 design partners. In parallel, complete the Phase 0 architecture spike and validate core security and workflow. Then run the draft-only preview; after its gates pass, provision a limited LinkedIn publishing beta cohort with approved access and human-approved publishing. Complete the Telegram, remote MCP, Autopilot, LinkedIn publishing/reconciliation, Polar billing, seller-eligibility, legal, security and reliability gates before declaring v1.0.0 release-complete or enabling its paid trial/checkout. Stage 4 is the v1.0.0 release/paid launch; stage 5 broadens public availability of that same v1.0.0 version after customer evidence and marketing claims are validated. Do not compress or bypass these prerequisites to meet a calendar target.

# 22. Launch checklist

- [ ]  Brand name/logo/domain review completed.
- [ ]  Google OAuth production credentials and redirect URLs configured.
- [ ]  LinkedIn developer app/product/scopes checked during Phase 0 and tested with a real account; successful end-to-end publish evidence recorded before enabling live publishing.
- [ ]  Cloudflare adapter and runtime limits verified.
- [ ]  Supabase production reliability/plan and backups evaluated.
- [ ]  Groq/OpenRouter model IDs, quota limits and cost controls configured.
- [ ]  Telegram linking and commands pass authorization, replay, expiry and rate-limit tests; the end-to-end Telegram gate is passed and evidence is recorded.
- [ ]  Remote MCP transport/authentication, read/write tools, revocation, cross-tenant denial and unapproved-publish denial tested with target clients; MCP gate passed.
- [ ]  Autopilot-specific release gate passed: explicit user enablement, paid entitlement only, policy/limits/quiet-hours/prohibited-topic enforcement, fail-closed behavior, pause/reconciliation, audit events and end-to-end tests.
- [ ]  One Nunuza Solo Polar product/price configuration at USD $29/month verified in test mode; eligible seller onboarding, live provider configuration and all paid-launch gates completed before enabling live checkout.
- [ ]  Polar webhook signature and event handling tested in sandbox; live checkout stays disabled until seller eligibility, provider onboarding/configuration, legal terms, LinkedIn publishing acceptance and all release gates pass. Missing live Polar configuration does not block the draft-only preview or the no-charge LinkedIn publishing beta.
- [ ]  Trial, renewal and cancellation copy reviewed.
- [ ]  Terms and Privacy Policy reviewed before public launch.
- [ ]  Tenant isolation, duplicate publishing and pause behavior tested.
- [ ]  Responsive and accessibility checks passed.
- [ ]  Error monitoring, redacted logs, backups and rollback plan configured.
- [ ]  Real authorized LinkedIn test post successfully published and reconciled, with duplicate/idempotency evidence. If this is blocked, remain in a clearly labeled pre-release stage; v1.0.0 is not complete or launched.
- [ ]  No placeholder branding, fake analytics or dead CTAs.