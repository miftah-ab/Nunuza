# LinkedIn API Access — Phase 0 Feasibility Evidence

**Status:** PARTIALLY VERIFIED (T-19 to T-24 from public docs) | T-25 BLOCKED (requires LinkedIn developer app + credentials)
**Date compiled:** 2026-10-27
**Author:** Phase 0 spike investigation

> **Scope:** This document records only facts verified from official LinkedIn documentation. It does not record any live developer portal state, actual granted scopes, or live credentials — those require a LinkedIn developer app that does not yet exist or has not been confirmed. Nothing in this document constitutes a claim that publishing works or that an app has been approved.

---

## Sources used

All findings below come from the following official LinkedIn developer documentation pages. Each is cited per finding.

| ID | URL | Retrieved |
|----|-----|-----------|
| SRC-1 | https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access | 2026-10-27 |
| SRC-2 | https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/posts-api | 2026-10-27 |
| SRC-3 | https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow | 2026-10-27 |
| SRC-4 | https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits | 2026-10-27 |

---

## T-19 — Share on LinkedIn product eligibility

**Status: VERIFIED (from official public documentation)**

**Source:** SRC-1 — "Getting Access" page, section "Open Permissions (Consumer)"

**Finding:** The "Share on LinkedIn" product is listed as an **Open Permission** product:

> "The following permissions are available to all developers, and may be added via self-service through the LinkedIn Developer Portal, under the Products tab on your application page."

| Product | Permission | Type |
|---------|-----------|------|
| Share on LinkedIn | `w_member_social` | Member Auth |

**Meaning for Nunuza:**
- A developer app created on the LinkedIn Developer Portal can add "Share on LinkedIn" self-service — no manual review or special program approval is required.
- This is the only product Nunuza needs for personal-member text post publishing in v1.
- **IMPORTANT:** This is confirmed from documentation only. Whether a specific app has already added this product requires checking the actual app's Products tab in the portal — that cannot be verified without a developer app.

---

## T-20 — Required scope: w_member_social

**Status: VERIFIED (from official public documentation)**

**Source:** SRC-1 (Getting Access) and SRC-2 (Posts API Permissions table)

**Finding from SRC-1:**
> Share on LinkedIn → `w_member_social` → **Member Auth**: Post, comment and like posts on behalf of an authenticated member.

**Finding from SRC-2 (Posts API Permissions table):**
> `w_member_social` — Post, comment, and like posts on behalf of an authenticated member.

**Required for Nunuza v1:** `w_member_social` only. This is the sole scope needed for personal-member text post creation.

**NOT needed for v1 (and cannot be requested without special approval):**
- `w_organization_social` — organizational/company page posting (explicitly excluded from v1 scope by BED-05)
- `r_organization_social` — organizational post reads
- `r_member_social` — see T-22 below

---

## T-21 — Current Posts API endpoint and required version header

**Status: VERIFIED (from official public documentation)**

**Source:** SRC-2 (Posts API), confirmed on the canonical URL at li-lms-2026-10

**Current endpoint:**
```
POST https://api.linkedin.com/rest/posts
```

**Required headers for every request:**
```
Authorization: Bearer {ACCESS_TOKEN}
LinkedIn-Version: {YYYYMM format, e.g., 202610}
X-Restli-Protocol-Version: 2.0.0
Content-Type: application/json
```

**Minimum text-only post payload (personal member):**
```json
{
  "author": "urn:li:person:{MEMBER_ID}",
  "commentary": "Post text here",
  "visibility": "PUBLIC",
  "distribution": {
    "feedDistribution": "MAIN_FEED",
    "targetEntities": [],
    "thirdPartyDistributionChannels": []
  },
  "lifecycleState": "PUBLISHED",
  "isReshareDisabledByAuthor": false
}
```
Note: The `author` uses `urn:li:person:{id}` for personal members. The member ID is obtained from the OpenID Connect `sub` claim or the userinfo endpoint.

**Successful response:** HTTP 201; the `x-restli-id` response header contains the Post URN, e.g., `urn:li:share:...` or `urn:li:ugcPost:...`. This URN must be persisted per BED-03.

**Important version note (from SRC-2 metadata):**
- The doc page's `monikerRange` is `li-lms-2025-11` through `li-lms-2026-10`.
- The canonical URL resolves to `li-lms-2026-10` (October 2026 version).
- The `LinkedIn-Version` header value must be a YYYYMM date string. The spec correctly requires this be configurable, not hard-coded (BED-03: "Keep API version configurable and document the chosen version and sunset date in `/docs/INTEGRATIONS_LINKEDIN.md`").
- Specific version sunset dates are not published in public docs; check the developer portal and changelog.

**Deprecated endpoint (do not use):**
- `ugcPosts` API — explicitly retired; Posts API is the replacement.

---

## T-22 — r_member_social is restricted (analytics)

**Status: VERIFIED (from official public documentation)**

**Source:** SRC-2 (Posts API Permissions table)

**Finding:**
> `r_member_social` — Retrieve posts, comments, and likes on behalf of an authenticated member. This permission is **restricted** and is available to **approved users only**.

**Meaning for Nunuza:**
- `r_member_social` is **NOT** in the Open Permissions list (SRC-1 confirms only `w_member_social` and the OpenID Connect scopes are open).
- Post-level analytics (impressions, likes, comments, reach, engagement rate) are NOT accessible without a separate approval process not available via self-service.
- **This confirms BED-06 requirement:** The Performance page must use Nunuza workflow metrics (posts drafted, approved, published, failed) rather than LinkedIn performance metrics, until and unless `r_member_social` is separately approved.
- This is not a blocker for v1 draft-only preview, publishing beta, or initial v1.0.0 publishing capability. It only affects the analytics section.

---

## T-23 — OAuth flow requirements

**Status: VERIFIED (from official public documentation)**

**Source:** SRC-3 (Authorization Code Flow — 3-legged OAuth)

**Flow type:** Authorization Code Flow (3-legged OAuth). LinkedIn does NOT support PKCE in the standard documented flow as of the retrieved doc. The flow uses `client_secret` server-side.

**Step 1 — Authorization request:**
```
GET https://www.linkedin.com/oauth/v2/authorization
  ?response_type=code
  &client_id={CLIENT_ID}
  &redirect_uri={ENCODED_CALLBACK_URL}
  &state={CSRF_TOKEN}
  &scope=w_member_social%20openid%20profile%20email
```

Key constraints on `redirect_uri`:
- Must be absolute (e.g., `https://example.com/auth/linkedin/callback`)
- Must be registered in the developer app's Auth tab
- Cannot include `#` fragments
- Query parameters are ignored during matching

**Step 2 — Authorization code returned:**
- Appended to `redirect_uri` as `?code=...&state=...`
- Code expires in **30 minutes** — must be exchanged immediately
- Application MUST verify the `state` parameter matches before proceeding (CSRF protection)

**Step 3 — Token exchange:**
```
POST https://www.linkedin.com/oauth/v2/accessToken
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code={CODE}
&client_id={CLIENT_ID}
&client_secret={CLIENT_SECRET}
&redirect_uri={SAME_REDIRECT_URI}
```

**Token response fields:**
- `access_token` — bearer token (~500 chars; plan for 1000+)
- `expires_in` — seconds; currently **5,184,000 seconds (~60 days)**
- `refresh_token` — present in response
- `refresh_token_expires_in` — longer than access token
- `scope` — granted scopes

**Refresh tokens — IMPORTANT LIMITATION (from SRC-3):**
> "Programmatic refresh tokens are available for a limited set of partners. If this feature has been enabled for your application, see Programmatic Refresh Tokens for instructions."

**Meaning:** Standard LinkedIn apps do NOT have programmatic token refresh. Refresh requires re-running the authorization flow (which bypasses the consent screen if the member is still logged in and the token hasn't expired). After 60 days, if the token expires, the user must reconnect.

**Implication for BED-03:** "If tokens expire and no refresh path is available, pause publishing and ask the user to reconnect." — This is confirmed necessary. Nunuza must implement the 60-day expiry handling. The reconnect UX is mandatory, not optional.

**Required Nunuza implementation actions derived from this:**
1. Store access token encrypted server-side (never in browser, Telegram, MCP, or logs)
2. Track `expires_in` and warn user before expiry
3. On expiry, pause publishing and surface a reconnect action
4. Validate `state` parameter on callback to prevent CSRF
5. Use HTTPS redirect URIs only; register each environment (local, preview, production) separately

---

## T-24 — Rate limits (from official documentation)

**Status: NOT VERIFIED for app-specific limits (requires developer portal access with a registered app)**

**Source:** SRC-4 (Rate Limiting)

**What is documented publicly:**

> "Rate limits specify the maximum number of API calls that can be made in a 24-hour period. These limits reset at midnight UTC every day."

Two limit categories:
- **Application-level** — total calls your app can make per day
- **Member-level** — total calls a single member token can make per day, per app

> "Your application's daily rate limit varies based on which API endpoint you are using. **Standard rate limits are not published in documentation.**"

> "You can look up the rate limit of any endpoint your app has access to through the Developer Portal. Select your app from the list and navigate to its Analytics tab. This page will only show usage and rate limits for endpoints you have made at least 1 request to today (UTC). If you want to look up a rate limit for an endpoint not listed in your app's Analytics page, make 1 test call to that endpoint and refresh the Analytics page."

**HTTP 429 behavior:**
> "Rate limited requests will receive a 429 response. In rare cases, LinkedIn may also return a 429 response as part of infrastructure protection. API service will return to normal automatically."

**Rate limit alert emails:** Sent to Developer Admins at 75% of application-level quota (application-level threshold only, not member-level). Alerts are delayed ~1-2 hours after threshold.

**What this means for Nunuza (spec compliance per BED-03):**
- The spec correctly prohibits hard-coding "150 requests per member per day" — confirmed: LinkedIn does NOT publish standard values.
- Actual limits for `POST /rest/posts` must be checked in the developer portal after making at least one test request.
- The implementation must handle HTTP 429 with backoff and the provider reset guidance when available (429 response headers typically contain `Retry-After`).
- **Action required (BLOCKED — needs developer app):** Check the developer portal Analytics tab for actual limits after the app is created and at least one test request is made.

---

## T-25 — LinkedIn OAuth test and acceptance publish

**Status: BLOCKED**

**Reason:** No LinkedIn developer app exists (or has not been confirmed to exist). This test requires:
1. A LinkedIn developer app with "Share on LinkedIn" product added
2. Client ID and Client Secret (configured server-side; never in chat)
3. A registered redirect URI for the test environment
4. An authorized LinkedIn test account to OAuth through the flow
5. Explicit founder authorization to publish a real test post

**What remains to be documented after unblocking:**
- Actual granted scopes (from portal Auth tab)
- Actual API rate limits (from portal Analytics tab after first request)
- Successful OAuth flow evidence (redirect, code, token exchange)
- Successful POST to `/rest/posts`, returned Post URN from `x-restli-id` header
- Reconciliation evidence (post URN persisted, no duplicate on retry)
- Reconnect behavior test (revoke token, verify publishing paused, reconnect flow works)
- Failure test evidence (invalid token → 401 handling)

---

## Summary of findings

| Test | Status | Basis |
|------|--------|-------|
| T-19: Share on LinkedIn — self-serve | VERIFIED | SRC-1 official docs |
| T-20: w_member_social scope confirmed | VERIFIED | SRC-1, SRC-2 official docs |
| T-21: POST /rest/posts + required headers | VERIFIED | SRC-2 official docs |
| T-22: r_member_social restricted (not self-serve) | VERIFIED | SRC-2 official docs |
| T-23: OAuth 3-legged flow, token lifetime, no programmatic refresh for standard apps | VERIFIED | SRC-3 official docs |
| T-24: Standard rate limits not published; must check portal | NOT VERIFIED — requires developer app | SRC-4 official docs |
| T-25: Live OAuth test + acceptance publish | BLOCKED — requires developer app + credentials | — |

**Positive finding:** The required "Share on LinkedIn" product (`w_member_social`) is self-serve. No manual LinkedIn review is needed to add it to a developer app. This removes a major potential blocker for the publishing gate.

**Critical finding:** Programmatic token refresh is NOT available for standard LinkedIn developer apps. Nunuza must implement a 60-day token expiry workflow with user reconnect.

**Analytics finding confirmed:** `r_member_social` is restricted. v1 Performance page must use Nunuza workflow metrics per BED-06. This is already correctly specified.
