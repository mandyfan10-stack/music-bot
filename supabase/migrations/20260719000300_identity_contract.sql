-- Delayed identity contract. Apply only after the server/API, Edge Functions,
-- and frontend have been stable for seven days.

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
    RAISE EXCEPTION 'Duplicate reviews must be resolved before the identity contract';
  END IF;
END
$$;

DROP INDEX IF EXISTS public.idx_admins_user_id_pending;
DROP INDEX IF EXISTS public.idx_blocked_users_user_id_pending;

ALTER TABLE public.admins DROP CONSTRAINT IF EXISTS admins_pkey;
ALTER TABLE public.admins ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.admins ADD CONSTRAINT admins_pkey PRIMARY KEY (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_username ON public.admins (username);

ALTER TABLE public.blocked_users DROP CONSTRAINT IF EXISTS blocked_users_pkey;
ALTER TABLE public.blocked_users ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.blocked_users ADD CONSTRAINT blocked_users_pkey PRIMARY KEY (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_blocked_users_username ON public.blocked_users (username);