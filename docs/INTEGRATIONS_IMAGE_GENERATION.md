# Image Generation — Cloudflare Workers AI

Nunuza uses Black Forest Labs **FLUX.2 Klein 4B** through Cloudflare Workers AI to generate optional visuals for existing content drafts.

## Runtime configuration

Set these server-side environment variables in every runtime that serves the Next.js API:

- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: API token scoped to the account with Workers AI inference permission. Never use the global API key.

For local development, add them to `.env.local`. For production, add them as encrypted environment variables in the active hosting runtime. Do not add them to `NEXT_PUBLIC_*` variables or source control.

## Generation behavior

- Generation is explicitly user-triggered from the post editor.
- The API derives the workspace from the authenticated session and verifies post ownership.
- FLUX.2 Klein 4B is called through Cloudflare's multipart REST API with explicit dimensions and guidance. This is the selected low-cost model for Cloudflare's included free Workers AI allocation; Nunuza does not fall back to paid models.
- Available art directions: editorial photography, cinematic, conceptual editorial illustration, 3D render, and minimalist.
- Available formats: portrait (1024×1280), landscape (1280×720), and square (1024×1024). Portrait is the default for LinkedIn feed visuals.
- Prompts combine the post title/body, art direction, and optional user direction without silently truncating the user's instructions.
- Images are stored as JPEG files in the private `nunuza-generated-images` Supabase Storage bucket. Object paths are workspace/post scoped; browser previews use one-hour signed URLs.
- The API enforces five image generations per workspace per UTC hour for standard workspaces and 100 per hour for `internal_beta` (Private Beta) workspaces, using the existing atomic `usage_counters` RPC. These are application limits, not a promise that Cloudflare's shared daily free allocation can satisfy every workspace's requests.
- Cloudflare Workers AI currently includes 10,000 Neurons per account per day at no charge; the allocation resets at 00:00 UTC. Workers Free requests stop when the free allocation is exhausted. The 4B model uses substantially fewer Neurons per output than the 9B model. Nunuza does not select a paid model or enable a paid fallback. Generated images are limited to 5 MB and are never automatically published.
- Regenerating an image replaces the old object only after the new object is attached successfully.
- Adding an image to an already-approved post returns it to draft status so it must be reviewed again.

## Database migration

Apply `supabase/migrations/0018_cloudflare_image_generation.sql` after the Telegram migrations. It adds image metadata columns, creates the private storage bucket, and grants authenticated users read access only to objects under their own workspace folder. Uploads and signed URL creation use the server-only service-role client.

## Publishing boundary

This feature generates and attaches private images to Nunuza drafts. The existing LinkedIn publishing client still publishes text-only posts; image asset upload and image-post publishing to LinkedIn require a separate implementation and verification step.

## Prompting and text

Prompts are grounded in the post title and body, with one selected art direction and optional user direction. Explicit user subject instructions take priority; people are excluded unless the user explicitly requests them. The model is asked to create the image only. Exact text, labels, logos, and typography should be composited separately rather than requested from the image model.
