# Nunuza

Nunuza is a LinkedIn operations agent that helps professionals and businesses plan, create, review, and manage their LinkedIn content workflow.

It combines AI-assisted content planning and drafting with approval-based publishing, scheduling, and remote controls through connected tools.

**Website:** https://nunuza-xi.vercel.app

## What it does

- **Content planning:** Build a focused content plan around a workspace's goals and strategy.
- **AI-assisted writing:** Generate, edit, and revise LinkedIn post drafts.
- **Visual content:** Create image concepts and prepare image-based posts.
- **Review and approval:** Keep people in control. AI agents and connected MCP clients cannot approve their own drafts.
- **Scheduling and publishing:** Schedule eligible, approved posts and publish through a connected LinkedIn account.
- **Remote control:** Manage supported workflows through Telegram and compatible MCP clients.
- **Workspace operations:** Manage integrations, notifications, usage, and subscription status.

Publishing is subject to account eligibility, connected integrations, workspace entitlements, approval requirements, and platform limits. The application enforces a maximum of one post per day and seven posts in a rolling seven-day period.

## Technology

- Next.js App Router, React, and TypeScript
- Supabase Auth, PostgreSQL, and Row Level Security
- Cloudflare Workers and OpenNext
- Vercel for the web application
- LinkedIn OAuth and Posts API
- Telegram Bot API
- Model Context Protocol (MCP)
- AI provider integrations and Cloudflare Workers AI

## Local development

### Requirements

- Node.js 24
- npm
- A Supabase project for authenticated application features
- Provider credentials for the integrations and AI features you intend to run locally

### Setup

1. Clone the repository and enter the project directory:

   ```bash
   git clone https://github.com/miftah-ab/Nunuza.git
   cd Nunuza
   ```

2. Install dependencies:

   ```bash
   npm ci
   ```

3. Create your local environment file:

   **macOS / Linux**
   ```bash
   cp .env.example .env.local
   ```

   **Windows PowerShell**
   ```powershell
   Copy-Item .env.example .env.local
   ```

4. Add the credentials required for the features you are testing. See the .env.example file for variable names and descriptions. Never use production secrets in local development.

5. Start the development server:

   ```bash
   npm run dev
   ```

6. Open http://localhost:3000.

Some integrations require additional provider-side configuration, registered OAuth redirect URLs, Supabase migrations, or webhook setup. Review the relevant integration documentation before enabling them.

## Quality checks

Run these commands before submitting changes:

```bash
npm run lint
npm run type-check
npm run test
npm run build
```

For Cloudflare Worker type-checking and build validation:

```bash
npm run type-check:worker
npm run wrangler:build
```

## Repository layout

```text
src/
  app/             Next.js pages, layouts, and API routes
  components/      Application and shared UI components
  lib/              Domain logic, integrations, and services
  worker.ts         Cloudflare Worker entry point
public/             Static assets
docs/               Product, architecture, integration, and operations docs
supabase/           Database configuration and migrations
scripts/            Development and operational scripts
```

## Security and publishing model

- Secrets and private credentials must remain server-side and must never be committed.
- Supabase Row Level Security and server-side authorization enforce workspace boundaries.
- LinkedIn access tokens are encrypted at rest.
- Integrations must validate authentication, authorization, ownership, and webhook authenticity.
- AI and MCP clients may create or edit content, but cannot approve their own drafts.
- Publishing requires an explicit human approval and is subject to workspace entitlements and scheduling limits.
- Failed or ambiguous publishing operations must be handled safely; do not retry a potentially successful publish blindly.

## Deployment

The production web application is deployed through Vercel. Background jobs and supported worker workloads run through Cloudflare.

Production deployment requires correctly configured environment variables and secrets, applied database migrations, registered OAuth applications and redirect URLs, and configured webhooks. Do not enable an integration or paid capability until its production configuration and end-to-end checks are complete.

## Documentation

Integration-specific setup and implementation details are maintained in the docs directory. Start with:

- docs/PRODUCT_SPEC.md — product requirements and constraints
- docs/IMPLEMENTATION_STATUS.md — implementation and verification record
- docs/INTEGRATIONS_LINKEDIN.md — LinkedIn connection and publishing
- docs/INTEGRATIONS_TELEGRAM.md — Telegram integration
- docs/INTEGRATIONS_MCP.md — MCP integration

## License

This repository is private and is not licensed for redistribution unless the repository owner explicitly grants permission.
