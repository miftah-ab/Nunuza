# Nunuza

LinkedIn content operations for solo founders.

**Current stage:** Draft-only preview.

---

## Development setup

### 1. Install Node.js (no admin required)

If Node.js is not installed, download the portable zip:

```powershell
$ver = "24.22.1"
$zip = "$env:TEMP\node-portable.zip"
Invoke-WebRequest "https://nodejs.org/dist/v$ver/node-v$ver-win-x64.zip" -OutFile $zip -UseBasicParsing
Expand-Archive $zip "$env:USERPROFILE" -Force
Rename-Item "$env:USERPROFILE\node-v$ver-win-x64" "$env:USERPROFILE\node" -Force
[System.Environment]::SetEnvironmentVariable("Path","$([System.Environment]::GetEnvironmentVariable('Path','User'));$env:USERPROFILE\node","User")
```

### 2. Install dependencies

```powershell
& "$env:USERPROFILE\node\npm.cmd" install --legacy-peer-deps
```

### 3. Configure environment

```powershell
Copy-Item .env.example .env.local
# Edit .env.local — fill in Supabase, Google OAuth, and other values
```

### 4. Run locally

```powershell
& "$env:USERPROFILE\node\npm.cmd" run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Run tests

```powershell
& "$env:USERPROFILE\node\npm.cmd" test
```

### 6. Type-check

```powershell
& "$env:USERPROFILE\node\npm.cmd" run type-check
```

---

## Project structure

```
src/
  app/
    (marketing)/        # Public pages: /, /pricing, /login, /privacy, /terms
    app/                # Authenticated dashboard routes (Phase 3+)
    auth/               # OAuth route handlers
  components/
    layout/             # Logo, MarketingHeader, MarketingFooter
    ui/                 # Shared UI primitives (Phase 1+)
    marketing/          # Marketing-only components
  lib/
    config.ts           # Server-side env validation (server only)
    tokens.ts           # Design token constants
    utils.ts            # cn(), truncate(), formatDisplayDate()
  worker.ts             # Cloudflare Worker entry point (queue + cron)
public/
  brand/                # Logo SVGs — do not modify after approval
docs/
  PRODUCT_SPEC.md       # Single source of truth (read-only)
  BRAND.md              # Brand guide and token reference
  DECISIONS.md          # Change log for approved decisions
  IMPLEMENTATION_STATUS.md  # Phase/gate status
  INTEGRATIONS_LINKEDIN.md
  INTEGRATIONS_TELEGRAM.md
  INTEGRATIONS_MCP.md
  evidence/             # LinkedIn API feasibility research
  architecture/         # Phase 0 spike notes
```

---

## Current phase status

See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for detailed status.

| Phase | Status |
|-------|--------|
| Phase 0: Inspect and report | VERIFIED |
| Phase 1: Foundation and brand | IN PROGRESS |
| Phase 2: Auth, database, onboarding | NOT STARTED |
| Phase 3: Content workflow | NOT STARTED |
| Phase 4: Integrations | NOT STARTED (LinkedIn BLOCKED) |
| Phase 5: Background agent | NOT STARTED |
| Phase 6: Hardening and release | NOT STARTED |

---

## Key constraints

- **No secrets in source control.** All secrets via `.env.local` locally, Cloudflare secrets in production.
- **No publishing without verified LinkedIn API access.** Live publishing gate is BLOCKED until a developer app is confirmed and an acceptance test publish succeeds.
- **No checkout until all paid-launch gates pass.** Checkout is disabled in this release.
- **No Autopilot in preview or beta.** Autopilot is enabled only for paid workspaces after its own gate passes.
- See `docs/PRODUCT_SPEC.md` BED-01 through BED-11 for all binding decisions.
