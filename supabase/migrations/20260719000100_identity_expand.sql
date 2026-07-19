-- Expand phase: safe to apply while the current frontend and Edge Functions run.

ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS user_id BIGINT;

UPDATE public.admins
SET username = lower(trim(leading '@' FROM username));

UPDATE public.blocked_users
SET username = lower(trim(leading '@' FROM username));

-- Backfill a blocked Telegram ID only when all authored content with this
-- username belongs to exactly one stable Telegram user_id.
WITH authored_users AS (
  SELECT lower(trim(leading '@' FROM author_username)) AS username, author_id
  FROM public.reviews
  WHERE author_username IS NOT NULL AND author_username <> ''
  UNION
  SELECT lower(trim(leading '@' FROM author_username)) AS username, author_id
  FROM public.review_comments
  WHERE author_username IS NOT NULL AND author_username <> ''
),
unambiguous AS (
  SELECT username, min(author_id) AS user_id
  FROM authored_users
  GROUP BY username
  HAVING count(DISTINCT author_id) = 1
)
UPDATE public.blocked_users AS blocked
SET user_id = candidate.user_id
FROM unambiguous AS candidate
WHERE blocked.user_id IS NULL
  AND lower(blocked.username) = candidate.username;

CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_user_id_pending
  ON public.admins (user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_blocked_users_user_id_pending
  ON public.blocked_users (user_id)
  WHERE user_id IS NOT NULL;

COMMENT ON COLUMN public.admins.user_id IS
  'Stable Telegram user ID. Must be bound and verified before the contract migration.';

COMMENT ON COLUMN public.blocked_users.user_id IS
  'Stable Telegram user ID used for enforcement; username is informational only.';

-- Operator gates before applying the contract migration:
-- 1. Have every current administrator perform a signed Telegram login.
-- 2. Read the verified userId returned by the auth function.
-- 3. Bind it explicitly:
--      UPDATE public.admins SET user_id = <verified_id>
--      WHERE username = '<verified_username>';
-- 4. Resolve every remaining blocked_users row with a NULL user_id.
-- 5. Resolve duplicate reviews returned by:
--      SELECT release_id, author_id, count(*)
--      FROM public.reviews GROUP BY 1, 2 HAVING count(*) > 1;
