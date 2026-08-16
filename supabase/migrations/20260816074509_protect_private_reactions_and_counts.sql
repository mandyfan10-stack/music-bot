-- Keep like/reaction identities private while preserving a public aggregate
-- reaction count for reviews and deterministic Realtime updates.

-- Hosted drift left two unauthenticated SECURITY DEFINER development RPCs in
-- production. They bypass every release RLS policy and must not exist in any
-- environment.
DROP FUNCTION IF EXISTS public.dev_create_release(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION
);
DROP FUNCTION IF EXISTS public.dev_delete_release(TEXT);

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS reaction_count INTEGER NOT NULL DEFAULT 0
  CHECK (reaction_count >= 0);

-- This is a server-owned backfill, not an end-user review edit. The existing
-- trigger rejects updates without a Telegram JWT, so suspend only that trigger
-- for this statement. A failed migration rolls the trigger state back too.
ALTER TABLE public.reviews DISABLE TRIGGER reviews_server_fields;
UPDATE public.reviews AS review
SET reaction_count = (
  SELECT count(*)::INTEGER
  FROM public.review_reactions AS reaction
  WHERE reaction.review_id = review.id
);
ALTER TABLE public.reviews ENABLE TRIGGER reviews_server_fields;

-- Review updates must never let the caller replace server-owned identity or
-- timestamp fields. This also permits the private reaction-count trigger to
-- update only reaction_count without changing the review author.
CREATE OR REPLACE FUNCTION public.set_review_server_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  objective NUMERIC;
BEGIN
  -- The aggregate-count trigger updates this row from inside another trigger.
  -- Preserve the review payload without requiring an end-user JWT for that
  -- internal maintenance update (for example during a service-role cascade).
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
  NEW.rating := round((NEW.base_rating + objective) / 2.0, 1);
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION private.adjust_review_reaction_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.reviews
    SET reaction_count = reaction_count + 1
    WHERE id = NEW.review_id;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE public.reviews
    SET reaction_count = greatest(reaction_count - 1, 0)
    WHERE id = OLD.review_id;
    RETURN OLD;
  END IF;

  IF OLD.review_id IS DISTINCT FROM NEW.review_id THEN
    UPDATE public.reviews
    SET reaction_count = greatest(reaction_count - 1, 0)
    WHERE id = OLD.review_id;
    UPDATE public.reviews
    SET reaction_count = reaction_count + 1
    WHERE id = NEW.review_id;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION private.adjust_review_reaction_count()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS review_reactions_adjust_count
  ON public.review_reactions;
CREATE TRIGGER review_reactions_adjust_count
AFTER INSERT OR DELETE OR UPDATE OF review_id
ON public.review_reactions
FOR EACH ROW EXECUTE FUNCTION private.adjust_review_reaction_count();

DROP POLICY IF EXISTS select_likes ON public.likes;
DROP POLICY IF EXISTS select_own_likes ON public.likes;
CREATE POLICY select_own_likes ON public.likes
  FOR SELECT TO authenticated
  USING (user_id = public.current_telegram_user_id());

DROP POLICY IF EXISTS select_reactions ON public.review_reactions;
DROP POLICY IF EXISTS select_own_reactions ON public.review_reactions;
CREATE POLICY select_own_reactions ON public.review_reactions
  FOR SELECT TO authenticated
  USING (user_id = public.current_telegram_user_id());

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
  public.user_id_is_admin(r.author_id) AS "authorIsAdmin"
FROM public.reviews AS r;

CREATE OR REPLACE VIEW public.comments_view
WITH (security_invoker = true)
AS
SELECT
  c.id,
  c.review_id AS "reviewId",
  c.author_id AS "authorId",
  c.author_username AS "authorUsername",
  c.author_display_name AS "author",
  c.text,
  c.timestamp,
  to_char(to_timestamp(c.timestamp / 1000.0) AT TIME ZONE 'UTC', 'DD.MM.YYYY') AS "date",
  public.user_id_is_admin(c.author_id) AS "authorIsAdmin",
  r.release_id AS "relId"
FROM public.review_comments AS c
JOIN public.reviews AS r ON r.id = c.review_id;

-- Realtime publications are hosted state too; make the repository migration
-- sufficient for a fresh project instead of relying on Dashboard toggles.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH table_name IN ARRAY ARRAY[
      'releases', 'reviews', 'review_comments', 'likes',
      'review_reactions', 'blocked_users'
    ]
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = table_name
      ) THEN
        EXECUTE format(
          'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
          table_name
        );
      END IF;
    END LOOP;
  END IF;
END
$$;
