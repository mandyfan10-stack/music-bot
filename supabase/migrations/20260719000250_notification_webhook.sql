-- Replace the legacy webhook, which embedded an anon JWT, with a Vault-backed
-- service-role call. Configure both Vault secrets before enabling notifications.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.tr_send_release_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault, net
AS $$
DECLARE
  webhook_url TEXT;
  service_role_key TEXT;
  request_id BIGINT;
BEGIN
  SELECT decrypted_secret INTO webhook_url
  FROM vault.decrypted_secrets
  WHERE name = 'notification_webhook_url';

  SELECT decrypted_secret INTO service_role_key
  FROM vault.decrypted_secrets
  WHERE name = 'notification_webhook_service_role';

  IF webhook_url IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING 'Notification webhook Vault secrets are not configured';
    RETURN NEW;
  END IF;

  SELECT net.http_post(
    url := webhook_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key,
      'apikey', service_role_key
    ),
    body := jsonb_build_object(
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA,
      'record', row_to_json(NEW)
    )
  ) INTO request_id;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.tr_send_release_notification() FROM PUBLIC;

DROP TRIGGER IF EXISTS tr_releases_insert_notification ON public.releases;
CREATE TRIGGER tr_releases_insert_notification
AFTER INSERT ON public.releases
FOR EACH ROW EXECUTE FUNCTION public.tr_send_release_notification();