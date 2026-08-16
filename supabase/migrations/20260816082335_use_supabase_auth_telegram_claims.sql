-- Supabase projects using asymmetric signing keys do not expose a private
-- signing key to Edge Functions. Telegram users therefore receive a normal
-- Supabase Auth session. The stable Telegram identity is an admin-owned claim;
-- the Auth UUID in sub remains untouched.
CREATE OR REPLACE FUNCTION public.current_telegram_user_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  WITH claims AS (
    SELECT
      coalesce(auth.jwt() -> 'app_metadata' ->> 'telegram_user_id', '')
        AS telegram_user_id,
      coalesce(auth.jwt() ->> 'sub', '') AS legacy_sub
  )
  SELECT CASE
    WHEN telegram_user_id ~ '^[1-9][0-9]{0,15}$'
      THEN telegram_user_id::BIGINT
    WHEN legacy_sub ~ '^[1-9][0-9]{0,15}$'
      THEN legacy_sub::BIGINT
    ELSE NULL
  END
  FROM claims
$$;

CREATE OR REPLACE FUNCTION public.jwt_username()
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT lower(trim(leading '@' FROM coalesce(
    auth.jwt() -> 'app_metadata' ->> 'username',
    ''
  )))
$$;

CREATE OR REPLACE FUNCTION public.jwt_display_name()
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'display_name', ''),
    nullif('@' || public.jwt_username(), '@'),
    'user-' || public.current_telegram_user_id()::TEXT
  )
$$;
