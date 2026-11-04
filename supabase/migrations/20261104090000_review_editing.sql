-- Редактирование рецензий автором + закрытие прямой записи серверных полей.
--
-- До этой миграции роль authenticated имела INSERT/UPDATE на все колонки
-- public.reviews, а триггер set_review_server_fields не охранял
-- reaction_count, release_id и id. Через Data API автор мог накрутить своей
-- рецензии счётчик «полезно», перенести её на другой релиз или сменить id.

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS edited_at BIGINT;

CREATE OR REPLACE FUNCTION public.set_review_server_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  objective NUMERIC;
BEGIN
  -- Вложенный вызов — только private.adjust_review_reaction_count(): он
  -- меняет reaction_count, всё остальное остаётся как было.
  IF pg_trigger_depth() > 1 THEN
    NEW.id := OLD.id;
    NEW.release_id := OLD.release_id;
    NEW.author_id := OLD.author_id;
    NEW.author_username := OLD.author_username;
    NEW.author_display_name := OLD.author_display_name;
    NEW.timestamp := OLD.timestamp;
    NEW.text := OLD.text;
    NEW.criteria := OLD.criteria;
    NEW.base_rating := OLD.base_rating;
    NEW.objective_rating := OLD.objective_rating;
    NEW.rating := OLD.rating;
    NEW.edited_at := OLD.edited_at;
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
    NEW.reaction_count := 0;
    NEW.edited_at := NULL;
  ELSE
    NEW.id := OLD.id;
    NEW.release_id := OLD.release_id;
    NEW.author_id := OLD.author_id;
    NEW.author_username := OLD.author_username;
    NEW.author_display_name := OLD.author_display_name;
    NEW.timestamp := OLD.timestamp;
    NEW.reaction_count := OLD.reaction_count;
    IF NEW.text IS DISTINCT FROM OLD.text
       OR NEW.criteria IS DISTINCT FROM OLD.criteria THEN
      NEW.edited_at := extract(epoch FROM clock_timestamp()) * 1000;
    ELSE
      NEW.edited_at := OLD.edited_at;
    END IF;
  END IF;

  NEW.objective_rating := objective;
  NEW.base_rating := GREATEST(1, LEAST(10, round(objective)::integer));
  NEW.rating := objective;
  RETURN NEW;
END
$$;

-- Колоночные права: клиент пишет только то, что create_review/update_review
-- реально передают. Остальное заполняет триггер.
REVOKE INSERT, UPDATE ON public.reviews FROM authenticated;
GRANT INSERT (
  id, release_id, author_id, author_username, author_display_name,
  text, base_rating, criteria, rating, objective_rating
) ON public.reviews TO authenticated;
GRANT UPDATE (text, criteria, base_rating) ON public.reviews TO authenticated;

CREATE OR REPLACE FUNCTION public.update_review(
  p_id TEXT,
  p_text TEXT,
  p_criteria JSONB
)
RETURNS public.reviews
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  updated public.reviews;
BEGIN
  -- SECURITY INVOKER: строку видит и меняет только автор (политика
  -- update_reviews), текст проверяет CHECK таблицы, критерии — триггер.
  UPDATE public.reviews
  SET text = p_text, criteria = p_criteria
  WHERE id = p_id
  RETURNING * INTO updated;

  IF updated.id IS NULL THEN
    RAISE EXCEPTION 'Review not found or not editable' USING ERRCODE = 'P0002';
  END IF;
  RETURN updated;
END
$$;

REVOKE ALL ON FUNCTION public.update_review(TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_review(TEXT, TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_review(TEXT, TEXT, JSONB) TO authenticated;

CREATE OR REPLACE VIEW public.reviews_view
WITH (security_invoker = true)
AS
SELECT
  r.id,
  r.release_id AS "relId",
  r.author_id AS "authorId",
  r.author_username AS "authorUsername",
  r.author_display_name AS "author",
  r.text,
  r.base_rating AS "baseRating",
  r.criteria,
  r.rating,
  r.objective_rating AS "objectiveRating",
  r.timestamp,
  to_char(to_timestamp(r.timestamp / 1000.0) AT TIME ZONE 'UTC', 'DD.MM.YYYY') AS "date",
  r.reaction_count AS "reactionCount",
  public.user_id_is_admin(r.author_id) AS "authorIsAdmin",
  r.edited_at AS "editedAt"
FROM public.reviews AS r;
