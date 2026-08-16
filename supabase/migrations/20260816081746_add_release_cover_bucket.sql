-- Release artwork is public catalog media, but writes stay server-only.
-- The release-cover Edge Function verifies Telegram initData and the live
-- admins table before using its service-role client to upload an object.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'release-covers',
  'release-covers',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public buckets allow object downloads without a SELECT policy. Deliberately
-- do not grant INSERT/UPDATE/DELETE policies to anon or authenticated: uploads
-- are accepted only by the server-side Edge Function after an admin check.
