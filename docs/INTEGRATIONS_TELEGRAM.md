# Nunuza — Telegram Integration

**Status:** Implementation required for v1.0.0. Gate PENDING.
**Phase:** Phase 4 (full implementation), Phase 1 (stub/disabled state only)

> Telegram is a required v1.0.0 capability per BED-07 and BED-09. It may be hidden during the draft-only preview and LinkedIn publishing beta while its gate is pending. Once the gate passes, it must be enabled. Do not defer beyond v1.0.0.

---

## Gate status

- [ ] Telegram bot created via @BotFather
- [ ] `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` configured
- [ ] Webhook registered and secret validated
- [ ] Linking flow end-to-end tested
- [ ] Authorization, replay, expiry and rate-limit tests passed
- [ ] Telegram gate passed → integration enabled for users

Until this gate passes, the Integrations page shows only: "Integration not enabled."

---

## Commands (Phase 4)

| Command | Action |
|---------|--------|
| `/start` | Help and secure account-link deep link |
| `/status` | Agent, integration, trial and next-post status |
| `/pause` | Pause autonomous work |
| `/resume` | Resume after entitlement/integration checks |
| `/drafts` | List drafts needing review |
| `/approve <draft-id>` | Approve a draft when policy allows |
| `/reject <draft-id>` | Reject a draft with optional feedback |
| `/report` | Recent activity and available performance summary |
| `/help` | Commands and explanation |

---

## Security requirements

- Linking token: cryptographically random, single-use, short-lived, hashed server-side, bound to authenticated user/workspace.
- Validate Telegram webhook secret on every incoming request.
- Deduplicate webhook `update_id` values to prevent replay attacks.
- Enforce tenant ownership on every action.
- Rate-limit commands per workspace.
- Never trust user-supplied workspace IDs or Telegram user IDs as identity proof.

---

## Implementation notes

- Telegram cannot bypass Approval Required mode.
- Approval actions require a specific draft ID and confirmation response.
- Notification failures are retried within bounds; they never block a successful publish.
- If Telegram is unavailable, the dashboard remains fully functional.
