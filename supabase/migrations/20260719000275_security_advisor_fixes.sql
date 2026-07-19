-- Tighten helper-function resolution and make client denial explicit.

ALTER FUNCTION public.current_telegram_user_id()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.jwt_username()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.jwt_display_name()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.validated_criterion(JSONB, TEXT)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_review_server_fields()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_comment_server_fields()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_actor_server_fields()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_subscriber_server_fields()
  SET search_path = pg_catalog, public;

-- Trigger functions are invoked by PostgreSQL, never through the Data API.
REVOKE ALL ON FUNCTION public.tr_send_release_notification()
  FROM anon, authenticated;

-- These helpers are only needed by authenticated RLS policies.
REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM anon;
REVOKE ALL ON FUNCTION public.current_user_is_blocked() FROM anon;

DROP POLICY IF EXISTS notification_deliveries_deny_client_access
  ON public.notification_deliveries;
CREATE POLICY notification_deliveries_deny_client_access
  ON public.notification_deliveries
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
