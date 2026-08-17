-- Client-generated ids let Realtime updates merge in place instead of
-- duplicating a just-created review or comment. Invalid ids fall back to
-- gen_random_uuid(); author, timestamp, and ratings stay server-owned.

DROP FUNCTION IF EXISTS public.create_review(TEXT, TEXT, INTEGER, JSONB);
DROP FUNCTION IF EXISTS public.create_comment(TEXT, TEXT);

CREATE FUNCTION public.create_review(
  p_release_id TEXT,
  p_text TEXT,
  p_base_rating INTEGER,
  p_criteria JSONB,
  p_id TEXT DEFAULT NULL
)
RETURNS public.reviews
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  created public.reviews;
  review_id TEXT;
BEGIN
  review_id := NULLIF(btrim(COALESCE(p_id, '')), '');
  IF review_id IS NULL OR review_id !~ '^[A-Za-z0-9_-]{8,80}$' THEN
    review_id := gen_random_uuid()::TEXT;
  END IF;

  INSERT INTO public.reviews (
    id, release_id, author_id, author_username, author_display_name,
    text, base_rating, criteria, rating, objective_rating
  )
  VALUES (
    review_id, p_release_id, public.current_telegram_user_id(),
    public.jwt_username(), public.jwt_display_name(), p_text, p_base_rating,
    p_criteria, 1, 1
  )
  RETURNING * INTO created;
  RETURN created;
END
$$;

CREATE FUNCTION public.create_comment(
  p_review_id TEXT,
  p_text TEXT,
  p_id TEXT DEFAULT NULL
)
RETURNS public.review_comments
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  created public.review_comments;
  comment_id TEXT;
BEGIN
  comment_id := NULLIF(btrim(COALESCE(p_id, '')), '');
  IF comment_id IS NULL OR comment_id !~ '^[A-Za-z0-9_-]{8,80}$' THEN
    comment_id := gen_random_uuid()::TEXT;
  END IF;

  INSERT INTO public.review_comments (
    id, review_id, author_id, author_username, author_display_name, text
  )
  VALUES (
    comment_id, p_review_id, public.current_telegram_user_id(),
    public.jwt_username(), public.jwt_display_name(), p_text
  )
  RETURNING * INTO created;
  RETURN created;
END
$$;

REVOKE ALL ON FUNCTION public.create_review(TEXT, TEXT, INTEGER, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_comment(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_review(TEXT, TEXT, INTEGER, JSONB, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.create_comment(TEXT, TEXT, TEXT) FROM anon;

GRANT EXECUTE ON FUNCTION public.create_review(TEXT, TEXT, INTEGER, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_comment(TEXT, TEXT, TEXT) TO authenticated;
