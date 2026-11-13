# Image Generation — Cloudflare Workers AI

Nunuza uses Leonardo **Lucid Origin** through Cloudflare Workers AI to generate optional visuals for existing content drafts. Lucid Origin is selected for its documented prompt adherence and support for a broad range of visual styles and specific creative direction.

## Runtime configuration

Set these server-side environment variables in every runtime that serves the Next.js API:

- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: API token scoped to the account with Workers AI inference permission. Never use the global API key.

For local development, add them to `.env.local`. For production, add them as encrypted environment variables in the active hosting runtime. Do not add them to `NEXT_PUBLIC_*` variables or source control.

## Generation behavior

- Generation is explicitly user-triggered from the post editor.
- The API derives the workspace from the authenticated session and verifies post ownership.
- Lucid Origin is called through Cloudflare's JSON REST API with explicit dimensions, prompt guidance, and 28 inference steps.
- Available art directions: editorial photography, cinematic, conceptual editorial illustration, 3D render, and minimalist.
- Subject controls: **Objects & scenes** (default; explicitly excludes people), **Abstract concept** (non-human visual metaphors), and **People** (only when deliberately selected).
- Prompts prioritize the selected subject and the user's exact creative direction. The default prompt explicitly prohibits random portraits, people, faces, bodies, silhouettes, and hands.
- Available formats: portrait (1024×1280), landscape (1280×720), and square (1024×1024). Portrait is the default for LinkedIn feed visuals.
- Images are stored as JPEG files in the private `nunuza-generated-images` Supabase Storage bucket. Object paths are workspace/post scoped; browser previews use one-hour signed URLs.
- The API enforces an atomic per-workspace hourly limit using the existing `usage_counters` RPC: **100 generations per UTC hour for `internal_beta` workspaces; 5 per UTC hour for all other entitlement types**.
- Generated images are limited to 5 MB and are never automatically published.
- Regenerating an image replaces the old object only after the new object is attached successfully.
- Adding an image to an already-approved post returns it to draft status so it must be reviewed again.

## Database migration

Apply `supabase/migrations/0018_cloudflare_image_generation.sql` after the Telegram migrations. It adds image metadata columns, creates the private storage bucket, and grants authenticated users read access only to objects under their own workspace folder. Uploads and signed URL creation use the server-only service-role client.

## Publishing boundary

This feature generates and attaches private images to Nunuza drafts. The existing LinkedIn publishing client still publishes text-only posts; image asset upload and image-post publishing to LinkedIn require a separate implementation and verification step.

## Prompting and text

Prompts are grounded in the post title and body, with one selected art direction, one selected subject mode, and optional user direction. The model is asked to create the image only. Exact text, labels, logos, and typography should be composited separately rather than requested from the image model.
