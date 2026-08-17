-- Итоговая оценка рецензии больше не усредняется с безымянной шкалой 1–10.
-- rating совпадает со средним шести критериев (objective_rating).
-- base_rating остаётся NOT NULL: пишем округлённое среднее для совместимости RPC.

CREATE OR REPLACE FUNCTION public.set_review_server_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  objective NUMERIC;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    NEW.author_id := OLD.author_id;
    NEW.author_username := OLD.author_username;
    NEW.author_display_name := OLD.author_display_name;
    NEW.timestamp := OLD.timestamp;
    NEW.criteria := OLD.criteria;
    NEW.base_rating := OLD.base_rating;
    NEW.objective_rating := OLD.objective_rating;
    NEW.rating := OLD.rating;
    RETURN NEW;
  END IF;

  IF public.current_telegram_user_id() IS NULL THEN
    RAISE EXCEPTION 'Authenticated Telegram user required';
  END IF;
  IF public.current_user_is_blocked() THEN
    RAISE EXCEPTION 'Blocked users cannot write reviews';
  END IF;
  IF jsonb_typeof(NEW.criteria) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(NEW.criteria)) <> 6 THEN
    RAISE EXCEPTION 'Exactly six rating criteria are required';
  END IF;

  objective := round((
    public.validated_criterion(NEW.criteria, 'sound') +
    public.validated_criterion(NEW.criteria, 'production') +
    public.validated_criterion(NEW.criteria, 'originality') +
    public.validated_criterion(NEW.criteria, 'meaning') +
    public.validated_criterion(NEW.criteria, 'relevance') +
    public.validated_criterion(NEW.criteria, 'image')
  ) / 6.0, 1);

  IF TG_OP = 'INSERT' THEN
    NEW.author_id := public.current_telegram_user_id();
    NEW.author_username := public.jwt_username();
    NEW.author_display_name := public.jwt_display_name();
    NEW.timestamp := extract(epoch FROM clock_timestamp()) * 1000;
  ELSE
    NEW.author_id := OLD.author_id;
    NEW.author_username := OLD.author_username;
    NEW.author_display_name := OLD.author_display_name;
    NEW.timestamp := OLD.timestamp;
  END IF;

  NEW.objective_rating := objective;
  NEW.base_rating := GREATEST(1, LEAST(10, round(objective)::integer));
  NEW.rating := objective;
  RETURN NEW;
END
$$;
