# Nunuza — LinkedIn Integration

**Status:** Phase 0 feasibility complete. Live integration: BLOCKED (no developer app confirmed).
**Last updated:** 2026-10-27

> This document is required by BED-10 and BED-03. It records the LinkedIn API version chosen, access requirements, implementation contract, and evidence status.
> Update this file whenever a new API version is adopted, access is granted, or an acceptance test is performed.

---

## API version

| Field | Value |
|-------|-------|
| Current LinkedIn API version header | `202410` |
| Header name | `LinkedIn-Version` |
| Sunset date | Not published by LinkedIn for `202410`; check the developer portal changelog before each deployment |
| Configuration | `LINKEDIN_API_VERSION` environment variable (see `.env.example`); do not hard-code |

Update the API version and sunset date here whenever the version is changed. The spec (BED-03) requires this field to be kept current.

---

## Access requirements

| Requirement | Status |
|-------------|--------|
| LinkedIn developer app created | UNKNOWN — not confirmed |
| "Share on LinkedIn" product added to app | UNKNOWN |
| `w_member_social` scope granted | UNKNOWN |
| Redirect URIs registered | UNKNOWN |

---

## OAuth flow

**Flow type:** Authorization Code (3-legged). `client_secret` is stored server-side only.

**Authorization endpoint:**
```
GET https://www.linkedin.com/oauth/v2/authorization
  ?response_type=code
  &client_id={LINKEDIN_CLIENT_ID}
  &redirect_uri={LINKEDIN_REDIRECT_URI}
  &state={CSRF_TOKEN}
  &scope=w_member_social%20openid%20profile%20email
```

**Token exchange:**
```
POST https://www.linkedin.com/oauth/v2/accessToken
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code={CODE}
&client_id={LINKEDIN_CLIENT_ID}
&client_secret={LINKEDIN_CLIENT_SECRET}
&redirect_uri={LINKEDIN_REDIRECT_URI}
```

**Token lifetime:** 60 days (`expires_in: 5184000`).

**Refresh tokens:** NOT available for standard LinkedIn developer apps. When the token expires, the user must reconnect. Nunuza must surface a reconnect prompt before or at expiry.

**State parameter:** Must be validated on callback to prevent CSRF. The implementation generates a cryptographically random state, stores it in an encrypted session cookie, and validates it on the callback.

---

## Publishing API

**Endpoint:** `POST https://api.linkedin.com/rest/posts`

**Required headers for every request:**
```
Authorization: Bearer {ACCESS_TOKEN}
LinkedIn-Version: {LINKEDIN_API_VERSION}
X-Restli-Protocol-Version: 2.0.0
Content-Type: application/json
```

**Minimum text post payload:**
```json
{
  "author": "urn:li:person:{MEMBER_ID}",
  "commentary": "{POST_TEXT}",
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

**Success response:** HTTP 201; post URN in `x-restli-id` header. This URN must be persisted in `content_posts.linkedin_post_id`.

---

## Rate limits

Standard rate limits for `POST /rest/posts` are **not published** by LinkedIn. To find actual limits:
1. Make at least one test request to the endpoint
2. Check the developer portal Analytics tab for that app

The implementation must handle HTTP 429 with exponential backoff and the `Retry-After` header value when provided.

**Do not hard-code any specific number of allowed requests per day.**

---

## Scopes

| Scope | Type | Available | Required for |
|-------|------|-----------|--------------|
| `w_member_social` | Open Permission | Self-serve (confirmed) | Publishing personal member posts |
| `openid` | Open Permission | Self-serve | OIDC user identity |
| `profile` | Open Permission | Self-serve | Member display name/photo |
| `email` | Open Permission | Self-serve | Member email |
| `r_member_social` | Restricted | NOT self-serve | Post analytics (NOT available in v1) |
| `w_organization_social` | Restricted | NOT self-serve | Company page publishing (NOT in v1 scope) |

**Source:** https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access (retrieved 2026-10-27)

---

## Security requirements

- OAuth tokens are encrypted at rest using `LINKEDIN_TOKEN_ENCRYPTION_KEY` (see `.env.example`).
- Tokens are never returned to the browser, logged, sent to Telegram, or included in MCP tool outputs.
- The `client_secret` is a server-only environment variable; never bundled into the Next.js client.
- Validate `state` parameter on OAuth callback to prevent CSRF.
- On token expiry (60 days), pause publishing and show a reconnect prompt.

---

## Required evidence (see also `/docs/evidence/linkedin-access.md`)

The following evidence must be recorded before any live publishing gate can pass:

- [ ] Developer app created, client ID documented (no secret)
- [ ] "Share on LinkedIn" product confirmed in app Products tab
- [ ] Exact granted scopes confirmed from Auth tab (no tokens)
- [ ] Actual rate limits for `POST /rest/posts` from developer portal Analytics tab
- [ ] Successful OAuth flow (redirect → code → token exchange)
- [ ] Successful `POST /rest/posts` with returned post URN (redacted)
- [ ] Reconciliation / duplicate-safety test evidence
- [ ] Reconnect behavior test
- [ ] Failure test evidence (401 handling, 429 backoff)
