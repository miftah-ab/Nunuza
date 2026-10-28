# Nunuza — Remote MCP Integration

**Status:** Implementation required for v1.0.0. Gate PENDING.
**Phase:** Phase 4 (full implementation), Phase 1 (stub/disabled state only)

> Remote MCP is a required v1.0.0 capability per BED-11 and Section 11 of the spec. It may be hidden during pre-release while its gate is pending. Once the gate passes it must be enabled. Do not defer beyond v1.0.0.

---

## Gate status

- [ ] MCP server implemented with a supported TypeScript MCP SDK
- [ ] Transport compatible with target clients documented
- [ ] Authentication: workspace-scoped, revocable, rotatable credentials
- [ ] All read and write tools implemented with strict input schemas
- [ ] Cross-tenant access denial verified
- [ ] Unapproved publishing denied
- [ ] Schema/tool discovery contains no `approve_draft` tool
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
