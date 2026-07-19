-- Keep SECURITY DEFINER implementations outside the exposed public schema.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

ALTER FUNCTION public.current_user_is_admin() SET SCHEMA private;
ALTER FUNCTION public.current_user_is_blocked() SET SCHEMA private;
ALTER FUNCTION public.user_id_is_admin(BIGINT) SET SCHEMA private;

REVOKE ALL ON FUNCTION private.current_user_is_admin()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.current_user_is_blocked()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.user_id_is_admin(BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.current_user_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_user_is_blocked() TO authenticated;
GRANT EXECUTE ON FUNCTION private.user_id_is_admin(BIGINT)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, private
AS $$
  SELECT private.current_user_is_admin()
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_blocked()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, private
AS $$
  SELECT private.current_user_is_blocked()
$$;

CREATE OR REPLACE FUNCTION public.user_id_is_admin(candidate_user_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, private
AS $$
  SELECT private.user_id_is_admin(candidate_user_id)
$$;

REVOKE ALL ON FUNCTION public.current_user_is_admin()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_user_is_blocked()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.user_id_is_admin(BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_blocked() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_id_is_admin(BIGINT)
  TO anon, authenticated;
