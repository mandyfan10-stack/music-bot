-- Уведомления автору рецензии о реакциях «полезно» и комментариях.
-- Новые строки review_reactions / review_comments пересылаются тем же
-- Vault-вебхуком, что и релизы (public.tr_send_release_notification —
-- универсальный: шлёт TG_TABLE_NAME и row_to_json(NEW)), в Edge Function
-- send-notifications. Решение «отправлять или нет» принимает
-- claim_review_activity_notification(): антиспам по рецензии и повторам.

-- Когда автору последний раз уходило уведомление по рецензии и виду.
CREATE TABLE IF NOT EXISTS public.review_activity_notifications (
  review_id TEXT NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('reaction', 'comment')),
  last_sent_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (review_id, kind)
);

-- Кто уже вызывал уведомление о реакции: снял и снова поставил — без повтора.
CREATE TABLE IF NOT EXISTS public.review_reaction_notified (
  review_id TEXT NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  actor_id BIGINT NOT NULL,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, actor_id)
);

ALTER TABLE public.review_activity_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_reaction_notified ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.review_activity_notifications FROM anon, authenticated;
REVOKE ALL ON public.review_reaction_notified FROM anon, authenticated;

DROP POLICY IF EXISTS review_activity_notifications_deny_client_access
  ON public.review_activity_notifications;
CREATE POLICY review_activity_notifications_deny_client_access
  ON public.review_activity_notifications
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS review_reaction_notified_deny_client_access
  ON public.review_reaction_notified;
CREATE POLICY review_reaction_notified_deny_client_access
  ON public.review_reaction_notified
  FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- Атомарно решает судьбу уведомления:
--   'duplicate' — этот человек уже вызывал уведомление о реакции;
--   'cooldown'  — по этой рецензии и виду уже писали меньше cooldown назад;
--   'send'      — отправлять; previous_sent_at — когда писали в прошлый раз.
CREATE OR REPLACE FUNCTION public.claim_review_activity_notification(
  p_review_id TEXT,
  p_kind TEXT,
  p_actor_id BIGINT DEFAULT NULL,
  p_cooldown_seconds INTEGER DEFAULT 1800
)
RETURNS TABLE (decision TEXT, previous_sent_at TIMESTAMPTZ)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  previous TIMESTAMPTZ;
  claimed BOOLEAN;
BEGIN
  IF p_kind NOT IN ('reaction', 'comment') THEN
    RAISE EXCEPTION 'Unknown review activity kind: %', p_kind;
  END IF;

  IF p_kind = 'reaction' AND p_actor_id IS NOT NULL THEN
    INSERT INTO public.review_reaction_notified (review_id, actor_id)
    VALUES (p_review_id, p_actor_id)
    ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'duplicate'::TEXT, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
  END IF;

  SELECT n.last_sent_at INTO previous
  FROM public.review_activity_notifications AS n
  WHERE n.review_id = p_review_id AND n.kind = p_kind
  FOR UPDATE;

  INSERT INTO public.review_activity_notifications AS n (review_id, kind, last_sent_at)
  VALUES (p_review_id, p_kind, now())
  ON CONFLICT (review_id, kind) DO UPDATE
    SET last_sent_at = now()
    WHERE n.last_sent_at < now() - make_interval(secs => GREATEST(p_cooldown_seconds, 0))
  RETURNING true INTO claimed;

  IF claimed IS NULL THEN
    RETURN QUERY SELECT 'cooldown'::TEXT, previous;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'send'::TEXT, previous;
END
$$;

REVOKE ALL ON FUNCTION public.claim_review_activity_notification(TEXT, TEXT, BIGINT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_review_activity_notification(TEXT, TEXT, BIGINT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_review_activity_notification(TEXT, TEXT, BIGINT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_review_activity_notification(TEXT, TEXT, BIGINT, INTEGER) TO service_role;

DROP TRIGGER IF EXISTS tr_review_reactions_insert_notification ON public.review_reactions;
CREATE TRIGGER tr_review_reactions_insert_notification
AFTER INSERT ON public.review_reactions
FOR EACH ROW EXECUTE FUNCTION public.tr_send_release_notification();

DROP TRIGGER IF EXISTS tr_review_comments_insert_notification ON public.review_comments;
CREATE TRIGGER tr_review_comments_insert_notification
AFTER INSERT ON public.review_comments
FOR EACH ROW EXECUTE FUNCTION public.tr_send_release_notification();
