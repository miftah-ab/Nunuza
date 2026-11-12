# Nunuza — Remote MCP Integration

**Status:** OAuth/MCP implementation is in the release-candidate branch. Production remains fail-closed.
**Phase:** Implementation complete; hosted OAuth configuration, preview deployment, and end-to-end verification remain release gates.

> Remote MCP is a required v1.0.0 capability per BED-11 and Section 11 of the spec. It may be hidden during pre-release while its gate is pending. Once the gate passes it must be enabled. Do not defer beyond v1.0.0.

---

## Gate status

- [ ] MCP server implemented with a supported TypeScript MCP SDK
- [ ] Transport compatible with target clients documented
- [ ] Authentication: workspace-scoped, revocable, rotatable credentials
- [ ] All read and write tools implemented with strict input schemas
- [ ] Cross-tenant access denial verified
- [ ] Unapproved publishing denied
- [x] `approve_draft` is exposed as an explicit owner-directed action; Claude Manual mode must set it to Needs approval
- [ ] MCP gate passed → integration enabled for users

Until this gate passes, the Integrations page shows only: "Integration not enabled."

---

## Tools — read (Phase 4)

| Tool | Description |
|------|-------------|
| `get_agent_status` | Current agent operational state |
| `get_content_plan` | Current content plan for the workspace |
| `list_drafts` | Drafts with status filter |
| `get_publishing_schedule` | Upcoming scheduled posts (when applicable) |
| `get_performance_summary` | Available workflow metrics |
| `list_recent_activity` | Recent job audit events |

## Tools — write (Phase 4)

| Tool | Description |
|------|-------------|
| `create_draft` | Create a new text draft |
| `edit_draft` | Edit an existing draft |
| `request_draft_revision` | Request an AI revision of a draft |
| `reject_draft` | Reject a draft with optional reason |
| `pause_agent` | Pause the workspace agent |
| `resume_agent` | Resume the workspace agent |
| `schedule_post` | Schedule an approved post (after MCP + LinkedIn + publishing gates pass) |
| `cancel_scheduled_post` | Cancel a scheduled post (same gate requirement) |

**`approve_draft` is NOT a v1.0.0 tool.** MCP clients and AI agents cannot approve their own drafts.

---

## Claude OAuth connection

Nunuza uses Supabase Auth's OAuth 2.1 authorization-code flow with PKCE. Claude receives a user-scoped access token only after the Nunuza account owner signs in and approves the requested connection. No workspace API key or fixed Authorization header is required for Claude.

### Customer flow

1. In Nunuza, open **Integrations → Connect Claude**.
2. Claude currently requires a one-time **Add custom connector** action in its own settings. Open [Claude Connectors](https://claude.ai/settings/connectors).
3. Add a custom connector named **Nunuza** and use the Nunuza `/api/mcp` endpoint shown in the app.
4. Choose **Sign in now** or **Sign in when needed**. Select OAuth authentication, not **No sign in**, and allow Claude to register as a client if prompted.
5. Claude discovers the OAuth server from the protected-resource metadata, then redirects the user to Nunuza.
6. The user signs in to Nunuza, reviews the access summary, and explicitly approves or denies.
7. Supabase Auth completes the authorization-code + PKCE exchange and Claude calls the MCP endpoint with the issued access token.

Anthropic brokers remote connector traffic from its cloud infrastructure. The MCP endpoint must be publicly reachable over HTTPS. Claude's custom-connector registration is a one-time action; Nunuza cannot create that connector inside the user's Claude account through a supported prefilled URL.

### Supabase project setup

The repository's local Supabase config enables the OAuth 2.1 server and dynamic client registration:

```toml
[auth.oauth_server]
enabled = true
authorization_url_path = "/oauth/consent"
allow_dynamic_registration = true
```

For the hosted Supabase project, an administrator must also enable **Authentication → OAuth Server**, configure the authorization path as `/oauth/consent`, and enable dynamic client registration. Confirm the production Site URL points to the Nunuza deployment.

Supabase OAuth access tokens include a verified `client_id` claim. Nunuza validates the token with Supabase Auth, derives the workspace from the token subject, and never accepts a workspace ID from Claude. The current Supabase OAuth server only supports the standard OIDC scopes; it does not support custom read/write OAuth scopes. Therefore the Nunuza consent screen explicitly describes the full MCP capabilities being granted. Do not advertise fine-grained OAuth scopes until Supabase supports them or Nunuza adds a separate authorization-grant layer.

### Token audience and direct Data API isolation

The applied `mcp_oauth_security` migration:

- Installs `public.custom_access_token_hook(jsonb)`, which changes the JWT audience to `https://nunuza-xi.vercel.app/api/mcp` only when the OAuth `client_id` claim is present. Normal browser sessions retain `aud=authenticated`.
- Moves the tenant helper to the non-exposed `private.current_workspace_id()` schema and updates existing tenant policies to use it.
- Adds restrictive RLS policies to every currently RLS-enabled public table. OAuth client tokens cannot use the Supabase Data API directly; normal authenticated sessions retain existing tenant policies.
- Revokes public RPC execution from the old workspace helper and the trigger-only user-creation function.

The migration was applied to the hosted database and committed as `supabase/migrations/20261111081409_mcp_oauth_security.sql`. SQL transaction tests verified OAuth tokens are blocked from workspace/content reads, normal browser sessions retain workspace access, OAuth hook claims receive the MCP audience, and browser claims keep their default audience. Supabase security advisors no longer report the related RLS or exposed SECURITY DEFINER findings.

### Important gate status

This OAuth path is not yet permission to enable MCP in production. The official MCP TypeScript SDK v2 owns the Streamable HTTP transport and bearer-auth middleware. The code, migration, and audience/RLS logic are in place, but the hosted Supabase Auth Custom Access Token hook and OAuth Server must still be enabled/configured in the Supabase dashboard. A healthy preview deployment and real Claude interoperability/revocation tests are also required before `MCP_ENABLED=true` or general availability. Legacy workspace API keys remain only for other MCP clients that cannot use OAuth; they are not part of Claude's setup.

---

## Security requirements

- Exactly one active MCP credential set per workspace in v1.
- Credentials: high entropy, hashed at rest, workspace-scoped, revocable, rotatable. Shown only once at creation.
- Rotation revokes the previous set immediately.
- All tools: authenticated, tenant-scoped, schema-validated, audited.
- Reject: cross-tenant IDs, unapproved publishing, expired subscriptions, revoked credentials.
- Return minimal data; never return access tokens or billing payment details.

---

## `approve_draft` prohibition

An MCP request, AI-generated tool call, schedule request, or previous approval of another version is NOT a human approval. The `approve_draft` tool must not exist in the tool schema. Human approval must be an explicit action by the authenticated human through the web app or Telegram.
