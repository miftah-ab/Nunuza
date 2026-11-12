-- Organic multi-image posts and document posts (PDF) for personal LinkedIn publishing.
-- Existing text posts remain valid and default to the text format.

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS post_format TEXT NOT NULL DEFAULT 'text';

ALTER TABLE public.content_posts
  DROP CONSTRAINT IF EXISTS content_posts_post_format_check;

ALTER TABLE public.content_posts
  ADD CONSTRAINT content_posts_post_format_check
  CHECK (post_format IN ('text', 'image_carousel', 'document'));

CREATE TABLE IF NOT EXISTS public.content_post_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES public.content_posts(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'document')),
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL CHECK (
    mime_type IN ('image/jpeg', 'image/png', 'application/pdf')
  ),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  alt_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_post_media_workspace_post_path_unique UNIQUE (workspace_id, post_id, storage_path)
);

-- Enforce tenant consistency at the database boundary: a media row can only
-- reference a post belonging to the same workspace, even under service-role code.
CREATE UNIQUE INDEX IF NOT EXISTS content_posts_workspace_id_id_uidx
  ON public.content_posts (workspace_id, id);

ALTER TABLE public.content_post_media
  DROP CONSTRAINT IF EXISTS content_post_media_post_id_fkey;

ALTER TABLE public.content_post_media
  ADD CONSTRAINT content_post_media_workspace_post_fkey
  FOREIGN KEY (workspace_id, post_id)
  REFERENCES public.content_posts (workspace_id, id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS content_post_media_post_order_idx
  ON public.content_post_media (workspace_id, post_id, sort_order, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS content_post_media_single_document_idx
  ON public.content_post_media (workspace_id, post_id)
  WHERE media_type = 'document';

ALTER TABLE public.content_post_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_post_media_workspace_select ON public.content_post_media;
CREATE POLICY content_post_media_workspace_select
  ON public.content_post_media FOR SELECT TO authenticated
  USING (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS content_post_media_workspace_insert ON public.content_post_media;
CREATE POLICY content_post_media_workspace_insert
  ON public.content_post_media FOR INSERT TO authenticated
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS content_post_media_workspace_update ON public.content_post_media;
CREATE POLICY content_post_media_workspace_update
  ON public.content_post_media FOR UPDATE TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

DROP POLICY IF EXISTS content_post_media_workspace_delete ON public.content_post_media;
CREATE POLICY content_post_media_workspace_delete
  ON public.content_post_media FOR DELETE TO authenticated
  USING (workspace_id = public.current_workspace_id());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'nunuza-post-media',
  'nunuza-post-media',
  FALSE,
  20971520,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = 20971520,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf'];

DROP POLICY IF EXISTS nunuza_post_media_owner_select ON storage.objects;
CREATE POLICY nunuza_post_media_owner_select
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'nunuza-post-media'
    AND (storage.foldername(name))[1] = public.current_workspace_id()::TEXT
  );

DROP POLICY IF EXISTS nunuza_post_media_owner_insert ON storage.objects;
CREATE POLICY nunuza_post_media_owner_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'nunuza-post-media'
    AND (storage.foldername(name))[1] = public.current_workspace_id()::TEXT
  );

DROP POLICY IF EXISTS nunuza_post_media_owner_update ON storage.objects;
CREATE POLICY nunuza_post_media_owner_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'nunuza-post-media'
    AND (storage.foldername(name))[1] = public.current_workspace_id()::TEXT
  )
  WITH CHECK (
    bucket_id = 'nunuza-post-media'
    AND (storage.foldername(name))[1] = public.current_workspace_id()::TEXT
  );

DROP POLICY IF EXISTS nunuza_post_media_owner_delete ON storage.objects;
CREATE POLICY nunuza_post_media_owner_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'nunuza-post-media'
    AND (storage.foldername(name))[1] = public.current_workspace_id()::TEXT
  );

COMMENT ON TABLE public.content_post_media IS
  'Workspace-scoped ordered media assets attached to content posts. Storage objects are private.';
COMMENT ON COLUMN public.content_posts.post_format IS
  'text: text-only post; image_carousel: organic multi-image post; document: PDF document post.';
COMMENT ON COLUMN public.content_posts.text IS
  'Optional LinkedIn commentary/caption. An empty string represents media-only posts.';
