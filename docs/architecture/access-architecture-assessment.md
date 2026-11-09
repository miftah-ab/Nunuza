# Nunuza v1.0.0 — Access Architecture Assessment

**Date:** 2026-11-09  
**Status:** Pre-implementation Architecture Audit  
**Governing Standard:** BED-01 through BED-11, Notion Product Spec v1.0  

---

## 1. Audit Findings on Existing Codebase

### A. Current Database Schema & Enums (Migrations 0001–0006)
- **Table `workspaces`:**
  - Has columns: `id`, `owner_user_id`, `name`, `state`, `entitlement_type`, `operating_mode`, `paused_at`, `created_at`, `updated_at`.
  - Currently **lacks** `access_mode` column. Access mode and entitlement are conflated into `entitlement_type`.
  - Enum `entitlement_type` currently contains: `'draft_only'`, `'internal_test'`, `'publishing_beta'`, `'paid_trial'`, `'paid_active'`, `'inactive'`.
  - Migration `0006_lock_down_privileges.sql` added trigger `guard_workspace_privileged_columns()`, which strictly prevents client roles from updating `entitlement_type`, `owner_user_id`, or `id`.
  - Database currently rejects `'internal_beta'`, `'suspended'`, and `'expired'` (Postgres error `22P02: invalid input value for enum entitlement_type`).

### B. Workspace Authorization & Entitlement Helpers (`src/lib/auth/workspace.ts`)
- `entitlementPermits()`, `canPublish()`, `canSchedule()`, and `canUseAutopilot()` rely on `entitlement_type`.
- Currently, `canUseAutopilot()` only permits `paid_trial` and `paid_active`, blocking beta workspaces.
- In-flight capability checks do not distinguish between **feature eligibility** (entitlement) vs. **integration readiness** (LinkedIn OAuth token) vs. **safety readiness** (rate limits, paused state).

### C. Polar Billing & Webhook Lifecycle (`src/lib/integrations/polar/service.ts`)
- Maps Polar states to `paid_trial`, `paid_active`, `inactive`.
- Does not yet distinguish `suspended` from `expired`.
- In-memory idempotency check and `billing_webhook_events` replay defense (300s window) are implemented and verified.
- Does not check `access_mode` to ensure a webhook for a commercial customer cannot accidentally overwrite a private beta tester's workspace.

### D. UI/UX Surfaces
- Multiple pages (`src/app/(marketing)/page.tsx`, `pricing/page.tsx`, `login/page.tsx`, `ContentManager.tsx`, `IntegrationsManager.tsx`) retain hardcoded mentions of "draft-only preview", "no checkout available in this release", and "publishing coming in later release".
- A customer who hasn't started checkout sees confusing "draft-only preview" banners instead of clear commercial onboarding ("Start your 14-day free trial ($29/mo)").

### E. Existing Internal Test Workspace (`6e46fc67-4f9a-402b-b4bd-2cbff1db0dbc`)
- Owner: `28c4d2a1-0054-4b88-88b8-138aef664320` (`fuhdjj7@gmail.com`).
- Current state: `active_approval_required`.
- Current entitlement: `publishing_beta`.
- Must be migrated to `access_mode = 'private_beta'`, `entitlement_type = 'internal_beta'`.

---

## 2. Final Access Architecture Design

### Separation of Responsibilities

```
┌────────────────────────────────────────────────────────┐
│                   Nunuza Workspace                     │
├──────────────────────────┬─────────────────────────────┤
│       access_mode        │      entitlement_type       │
│  (How access was granted)│ (Authoritative permissions) │
├──────────────────────────┼─────────────────────────────┤
│      private_beta        │        internal_beta        │
├──────────────────────────┼─────────────────────────────┤
│                          │          paid_trial         │
│                          │          paid_active        │
│       commercial         │          suspended          │
│                          │          expired            │
└──────────────────────────┴─────────────────────────────┘
```

### Access & Entitlement Matrix

| Access Mode | Entitlement Type | Payment | Feature Eligibility | Autopilot Eligible? |
| :--- | :--- | :--- | :--- | :--- |
| `private_beta` | `internal_beta` | None ($0, no card, no Polar) | Full v1.0.0 features | Yes (with explicit opt-in & safety controls) |
| `commercial` | `paid_trial` | 14-day trial (card required) | Full v1.0.0 features | Yes (with explicit opt-in & safety controls) |
| `commercial` | `paid_active` | $29/month | Full v1.0.0 features | Yes (with explicit opt-in & safety controls) |
| `commercial` | `suspended` | Payment unresolved / checkout pending | Restricted (Drafts/Settings/Export) | No |
| `commercial` | `expired` | Trial/subscription ended without renewal | Restricted (Export/Settings) | No |

---

## 3. Four-Tier Capability Evaluation Layer

Instead of collapsing all checks into a binary flag, every action will be evaluated through four explicit gates:

1. **Workspace Feature Eligibility:** Does `entitlement_type` permit this capability? (`internal_beta`, `paid_trial`, `paid_active`).
2. **Integration Readiness:** Is the required external provider connected and unexpired? (e.g. LinkedIn OAuth token present and valid).
3. **Safety Readiness:** Have rate limits, quiet hours, and pause gates passed? (Daily <= 1 post, weekly <= 7 posts, agent `paused_at === null`).
4. **Execution State:** Action is only permitted when:
   $$\text{Allowed} = \text{Eligible} \land \text{IntegrationReady} \land \text{SafetyReady}$$

This ensures the UI reports the true blocker (e.g. "Connect LinkedIn to publish") instead of a misleading "Draft-only preview active" message.

---

## 4. Administrative Provisioning & Revocation Architecture

- **Tool:** Server-side CLI `scripts/admin-provision.js` using `SUPABASE_SERVICE_ROLE_KEY`.
- **Capabilities:**
  - Grant private beta: sets `access_mode = 'private_beta'`, `entitlement_type = 'internal_beta'`, optional `beta_expires_at`, `beta_notes`.
  - Revoke private beta: sets `entitlement_type = 'suspended'`, safely pauses queued jobs, disables Autopilot, preserves all content and audit logs.
  - Inspect status and full audit history.
- **Audit Logging:** Every grant/revocation writes an immutable record to `audit_events`.

