-- Server/API rollout phase. This migration deliberately fails until identity binding and
-- data cleanup from 20260719000100_identity_expand.sql are complete.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.admins WHERE user_id IS NULL) THEN
    RAISE EXCEPTION 'Every admin must be bound to a verified Telegram user_id';
  END IF;
  IF EXISTS (SELECT 1 FROM public.blocked_users WHERE user_id IS NULL) THEN
    RAISE EXCEPTION 'Every blocked user must have a stable Telegram user_id';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.reviews
    GROUP BY release_id, author_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate reviews must be resolved before adding the unique constraint';
  END IF;
END
$$;


CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_release_author
  ON public.reviews (release_id, author_id);

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  release_id TEXT NOT NULL REFERENCES public.releases(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (release_id, user_id)
);

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_telegram_user_id()
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(auth.jwt() ->> 'sub', '')::BIGINT
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admins
    WHERE user_id = public.current_telegram_user_id()
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_blocked()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.blocked_users
    WHERE user_id = public.current_telegram_user_id()
  )
$$;

CREATE OR REPLACE FUNCTION public.user_id_is_admin(candidate_user_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins WHERE user_id = candidate_user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.jwt_username()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT lower(trim(leading '@' FROM coalesce(
    auth.jwt() -> 'user_metadata' ->> 'username',
    ''
  )))
$$;

CREATE OR REPLACE FUNCTION public.jwt_display_name()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    nullif(auth.jwt() -> 'user_metadata' ->> 'display_name', ''),
    nullif('@' || public.jwt_username(), '@'),
    'user-' || public.current_telegram_user_id()::TEXT
  )
$$;

CREATE OR REPLACE FUNCTION public.validated_criterion(criteria JSONB, criterion_key TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  criterion NUMERIC;
BEGIN
  IF jsonb_typeof(criteria -> criterion_key) <> 'number' THEN
    RAISE EXCEPTION 'Criterion % must be numeric', criterion_key;
  END IF;
  criterion := (criteria ->> criterion_key)::NUMERIC;
  IF criterion < 1 OR criterion > 10 THEN
    RAISE EXCEPTION 'Criterion % must be between 1 and 10', criterion_key;
  END IF;
  RETURN criterion;
END
$$;

CREATE OR REPLACE FUNCTION public.set_review_server_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  objective NUMERIC;
BEGIN
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
  NEW.author_id := public.current_telegram_user_id();
  NEW.author_username := public.jwt_username();
  NEW.author_display_name := public.jwt_display_name();
  NEW.objective_rating := objective;
  NEW.rating := round((NEW.base_rating + objective) / 2.0, 1);
  IF TG_OP = 'INSERT' THEN
    NEW.timestamp := extract(epoch FROM clock_timestamp()) * 1000;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.set_comment_server_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.current_telegram_user_id() IS NULL OR public.current_user_is_blocked() THEN
    RAISE EXCEPTION 'Active authenticated Telegram user required';
  END IF;
  NEW.author_id := public.current_telegram_user_id();
  NEW.author_username := public.jwt_username();
  NEW.author_display_name := public.jwt_display_name();
  IF TG_OP = 'INSERT' THEN
    NEW.timestamp := extract(epoch FROM clock_timestamp()) * 1000;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.set_actor_server_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.current_telegram_user_id() IS NULL OR public.current_user_is_blocked() THEN
    RAISE EXCEPTION 'Active authenticated Telegram user required';
  END IF;
  NEW.user_id := public.current_telegram_user_id();
  NEW.username := public.jwt_username();
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.set_subscriber_server_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.current_telegram_user_id() IS NULL OR public.current_user_is_blocked() THEN
    RAISE EXCEPTION 'Active authenticated Telegram user required';
  END IF;
  NEW.user_id := public.current_telegram_user_id();
  NEW.chat_id := public.current_telegram_user_id();
  NEW.username := public.jwt_username();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS reviews_server_fields ON public.reviews;
CREATE TRIGGER reviews_server_fields
BEFORE INSERT OR UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.set_review_server_fields();

DROP TRIGGER IF EXISTS comments_server_fields ON public.review_comments;
CREATE TRIGGER comments_server_fields
BEFORE INSERT OR UPDATE ON public.review_comments
FOR EACH ROW EXECUTE FUNCTION public.set_comment_server_fields();

DROP TRIGGER IF EXISTS likes_server_fields ON public.likes;
CREATE TRIGGER likes_server_fields
BEFORE INSERT OR UPDATE ON public.likes
FOR EACH ROW EXECUTE FUNCTION public.set_actor_server_fields();

DROP TRIGGER IF EXISTS reactions_server_fields ON public.review_reactions;
CREATE TRIGGER reactions_server_fields
BEFORE INSERT OR UPDATE ON public.review_reactions
FOR EACH ROW EXECUTE FUNCTION public.set_actor_server_fields();

DROP TRIGGER IF EXISTS subscribers_server_fields ON public.notification_subscribers;
CREATE TRIGGER subscribers_server_fields
BEFORE INSERT OR UPDATE ON public.notification_subscribers
FOR EACH ROW EXECUTE FUNCTION public.set_subscriber_server_fields();

CREATE OR REPLACE FUNCTION public.create_review(
  p_release_id TEXT,
  p_text TEXT,
  p_base_rating INTEGER,
  p_criteria JSONB
)
RETURNS public.reviews
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  created public.reviews;
BEGIN
  INSERT INTO public.reviews (
    id, release_id, author_id, author_username, author_display_name,
    text, base_rating, criteria, rating, objective_rating
  )
  VALUES (
    gen_random_uuid()::TEXT, p_release_id, public.current_telegram_user_id(),
    public.jwt_username(), public.jwt_display_name(), p_text, p_base_rating,
    p_criteria, 1, 1
  )
  RETURNING * INTO created;
  RETURN created;
END
$$;

CREATE OR REPLACE FUNCTION public.create_comment(p_review_id TEXT, p_text TEXT)
RETURNS public.review_comments
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  created public.review_comments;
BEGIN
  INSERT INTO public.review_comments (
    id, review_id, author_id, author_username, author_display_name, text
  )
  VALUES (
    gen_random_uuid()::TEXT, p_review_id, public.current_telegram_user_id(),
    public.jwt_username(), public.jwt_display_name(), p_text
  )
  RETURNING * INTO created;
  RETURN created;
END
$$;

CREATE OR REPLACE FUNCTION public.set_notification_enabled(p_enabled BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.notification_subscribers (user_id, username, chat_id, enabled)
  VALUES (
    public.current_telegram_user_id(), public.jwt_username(),
    public.current_telegram_user_id(), p_enabled
  )
  ON CONFLICT (user_id) DO UPDATE SET enabled = excluded.enabled;
  RETURN p_enabled;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_set_block(p_user_id BIGINT, p_blocked BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  latest_username TEXT;
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_user_id = public.current_telegram_user_id() THEN
    RAISE EXCEPTION 'Administrators cannot block themselves';
  END IF;
  IF p_blocked THEN
    SELECT lower(trim(leading '@' FROM author_username))
    INTO latest_username
    FROM (
      SELECT author_username, timestamp FROM public.reviews WHERE author_id = p_user_id
      UNION ALL
      SELECT author_username, timestamp FROM public.review_comments WHERE author_id = p_user_id
    ) authored
    WHERE author_username IS NOT NULL AND author_username <> ''
    ORDER BY timestamp DESC
    LIMIT 1;
    UPDATE public.blocked_users
    SET username = coalesce(latest_username, 'user-' || p_user_id::TEXT),
        blocked_at = now()
    WHERE user_id = p_user_id;
    IF NOT FOUND THEN
      INSERT INTO public.blocked_users (user_id, username)
      VALUES (p_user_id, coalesce(latest_username, 'user-' || p_user_id::TEXT));
    END IF;
  ELSE
    DELETE FROM public.blocked_users WHERE user_id = p_user_id;
  END IF;
  RETURN p_blocked;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_reviews(p_user_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  IF NOT public.current_user_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  DELETE FROM public.reviews WHERE author_id = p_user_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$$;

REVOKE ALL ON FUNCTION public.create_review(TEXT, TEXT, INTEGER, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_comment(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_notification_enabled(BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_block(BIGINT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_reviews(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_review(TEXT, TEXT, INTEGER, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.create_comment(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.set_notification_enabled(BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.admin_set_block(BIGINT, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.admin_delete_reviews(BIGINT) FROM anon;

GRANT EXECUTE ON FUNCTION public.create_review(TEXT, TEXT, INTEGER, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_comment(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_notification_enabled(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_block(BIGINT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_reviews(BIGINT) TO authenticated;

DROP POLICY IF EXISTS select_admins ON public.admins;
DROP POLICY IF EXISTS admin_all_releases ON public.releases;
DROP POLICY IF EXISTS insert_reviews ON public.reviews;
DROP POLICY IF EXISTS update_reviews ON public.reviews;
DROP POLICY IF EXISTS delete_reviews ON public.reviews;
DROP POLICY IF EXISTS insert_comments ON public.review_comments;
DROP POLICY IF EXISTS delete_comments ON public.review_comments;
DROP POLICY IF EXISTS insert_likes ON public.likes;
DROP POLICY IF EXISTS delete_likes ON public.likes;
DROP POLICY IF EXISTS insert_reactions ON public.review_reactions;
DROP POLICY IF EXISTS delete_reactions ON public.review_reactions;
DROP POLICY IF EXISTS select_blocked ON public.blocked_users;
DROP POLICY IF EXISTS admin_all_blocked ON public.blocked_users;
DROP POLICY IF EXISTS select_subscribers ON public.notification_subscribers;
DROP POLICY IF EXISTS all_subscribers ON public.notification_subscribers;

CREATE POLICY select_admins ON public.admins
  FOR SELECT TO authenticated USING (public.current_user_is_admin());

CREATE POLICY admin_all_releases ON public.releases
  FOR ALL TO authenticated
  USING (public.current_user_is_admin())
  WITH CHECK (public.current_user_is_admin());

CREATE POLICY insert_reviews ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = public.current_telegram_user_id()
    AND NOT public.current_user_is_blocked()
  );

CREATE POLICY update_reviews ON public.reviews
  FOR UPDATE TO authenticated
  USING (
    author_id = public.current_telegram_user_id()
    AND NOT public.current_user_is_blocked()
  )
  WITH CHECK (
    author_id = public.current_telegram_user_id()
    AND NOT public.current_user_is_blocked()
  );

CREATE POLICY delete_reviews ON public.reviews
  FOR DELETE TO authenticated
  USING (
    public.current_user_is_admin()
    OR (
      author_id = public.current_telegram_user_id()
      AND NOT public.current_user_is_blocked()
    )
  );

CREATE POLICY insert_comments ON public.review_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = public.current_telegram_user_id()
    AND NOT public.current_user_is_blocked()
  );

CREATE POLICY delete_comments ON public.review_comments
  FOR DELETE TO authenticated
  USING (
    public.current_user_is_admin()
    OR (
      author_id = public.current_telegram_user_id()
      AND NOT public.current_user_is_blocked()
    )
  );

CREATE POLICY insert_likes ON public.likes
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = public.current_telegram_user_id()
    AND NOT public.current_user_is_blocked()
  );

CREATE POLICY delete_likes ON public.likes
  FOR DELETE TO authenticated
  USING (
    user_id = public.current_telegram_user_id()
    AND NOT public.current_user_is_blocked()
  );

CREATE POLICY insert_reactions ON public.review_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = public.current_telegram_user_id()
    AND NOT public.current_user_is_blocked()
  );

CREATE POLICY delete_reactions ON public.review_reactions
  FOR DELETE TO authenticated
  USING (
    user_id = public.current_telegram_user_id()
    AND NOT public.current_user_is_blocked()
  );

CREATE POLICY select_blocked ON public.blocked_users
  FOR SELECT TO authenticated USING (
    user_id = public.current_telegram_user_id()
    OR public.current_user_is_admin()
  );

CREATE POLICY admin_all_blocked ON public.blocked_users
  FOR ALL TO authenticated
  USING (public.current_user_is_admin())
  WITH CHECK (public.current_user_is_admin());

CREATE POLICY select_subscribers ON public.notification_subscribers
  FOR SELECT TO authenticated
  USING (
    user_id = public.current_telegram_user_id()
    OR public.current_user_is_admin()
  );

CREATE POLICY all_subscribers ON public.notification_subscribers
  FOR ALL TO authenticated
  USING (
    user_id = public.current_telegram_user_id()
    AND NOT public.current_user_is_blocked()
  )
  WITH CHECK (
    user_id = public.current_telegram_user_id()
    AND NOT public.current_user_is_blocked()
  );

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
  COALESCE((
    SELECT count(*)::INTEGER FROM public.review_reactions rr WHERE rr.review_id = r.id
  ), 0) AS "reactionCount",
  public.user_id_is_admin(r.author_id) AS "authorIsAdmin"
FROM public.reviews r;

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
  public.user_id_is_admin(c.author_id) AS "authorIsAdmin"
FROM public.review_comments c;

REVOKE ALL ON FUNCTION public.current_telegram_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_is_blocked() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_id_is_admin(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_telegram_user_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_blocked() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_id_is_admin(BIGINT) TO anon, authenticated;
