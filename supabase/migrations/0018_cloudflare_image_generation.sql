-- Store generated post images privately and scope reads to the owning workspace.
ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS image_path TEXT,
  ADD COLUMN IF NOT EXISTS image_prompt TEXT,
  ADD COLUMN IF NOT EXISTS image_model TEXT,
  ADD COLUMN IF NOT EXISTS image_generated_at TIMESTAMPTZ;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'nunuza-generated-images',
  'nunuza-generated-images',
  FALSE,
  5242880,
  ARRAY['image/jpeg']
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg'];

DROP POLICY IF EXISTS nunuza_generated_images_owner_select ON storage.objects;
CREATE POLICY nunuza_generated_images_owner_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'nunuza-generated-images'
  AND (storage.foldername(name))[1] = public.current_workspace_id()::TEXT
);

COMMENT ON COLUMN public.content_posts.image_path IS
  'Private Supabase Storage object path for the generated post image. Never store a public URL.';
COMMENT ON COLUMN public.content_posts.image_prompt IS
  'The sanitized prompt used to generate the attached post image.';
COMMENT ON COLUMN public.content_posts.image_model IS
  'Image generation provider/model identifier used for auditability.';
