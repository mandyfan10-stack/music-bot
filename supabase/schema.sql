-- Схема базы данных XXII SOUND для PostgreSQL (Supabase)

-- 0. Таблица администраторов (admins)
CREATE TABLE IF NOT EXISTS public.admins (
    username TEXT PRIMARY KEY
);

-- 1. Таблица релизов (releases)
CREATE TABLE IF NOT EXISTS public.releases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    artist TEXT NOT NULL,
    img TEXT,
    link TEXT NOT NULL,
    genre TEXT,
    timestamp DOUBLE PRECISION DEFAULT (extract(epoch from now()) * 1000)
);

CREATE INDEX IF NOT EXISTS idx_releases_timestamp ON public.releases (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_releases_genre ON public.releases (genre);

-- 2. Таблица рецензий (reviews)
CREATE TABLE IF NOT EXISTS public.reviews (
    id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES public.releases(id) ON DELETE CASCADE,
    author_id BIGINT NOT NULL,
    author_username TEXT,
    author_display_name TEXT NOT NULL,
    text TEXT NOT NULL CHECK (char_length(text) >= 30 AND char_length(text) <= 3000),
    base_rating INT NOT NULL CHECK (base_rating >= 1 AND base_rating <= 10),
    criteria JSONB NOT NULL,
    rating NUMERIC(3,1) NOT NULL,
    objective_rating NUMERIC(3,1) NOT NULL,
    timestamp DOUBLE PRECISION DEFAULT (extract(epoch from now()) * 1000)
);

CREATE INDEX IF NOT EXISTS idx_reviews_release_id ON public.reviews (release_id);
CREATE INDEX IF NOT EXISTS idx_reviews_timestamp ON public.reviews (timestamp DESC);

-- 3. Таблица комментариев к рецензиям (review_comments)
CREATE TABLE IF NOT EXISTS public.review_comments (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
    author_id BIGINT NOT NULL,
    author_username TEXT,
    author_display_name TEXT NOT NULL,
    text TEXT NOT NULL CHECK (char_length(text) >= 1 AND char_length(text) <= 1000),
    timestamp DOUBLE PRECISION DEFAULT (extract(epoch from now()) * 1000)
);

CREATE INDEX IF NOT EXISTS idx_comments_review_id ON public.review_comments (review_id);
CREATE INDEX IF NOT EXISTS idx_comments_timestamp ON public.review_comments (timestamp DESC);

-- 4. Таблица лайков релизов (likes)
CREATE TABLE IF NOT EXISTS public.likes (
    release_id TEXT NOT NULL REFERENCES public.releases(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL,
    username TEXT,
    PRIMARY KEY (release_id, user_id)
);

-- 5. Таблица реакций на рецензии (review_reactions)
CREATE TABLE IF NOT EXISTS public.review_reactions (
    review_id TEXT NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL,
    username TEXT,
    PRIMARY KEY (review_id, user_id)
);

-- 6. Таблица заблокированных пользователей (blocked_users)
CREATE TABLE IF NOT EXISTS public.blocked_users (
    username TEXT PRIMARY KEY,
    user_id BIGINT,
    blocked_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Таблица подписчиков на пуши (notification_subscribers)
CREATE TABLE IF NOT EXISTS public.notification_subscribers (
    user_id BIGINT PRIMARY KEY,
    username TEXT,
    chat_id BIGINT,
    enabled BOOLEAN DEFAULT TRUE
);

-- ==========================================
-- ПРЕДСТАВЛЕНИЯ (VIEWS) ДЛЯ УДОБСТВА ВЫБОРКИ
-- ==========================================

-- Представление для рецензий с подсчетом лайков и флагом админа
CREATE OR REPLACE VIEW public.reviews_view AS
SELECT 
    r.id,
    r.release_id as "relId",
    r.author_id as "authorId",
    r.author_username as "authorUsername",
    r.author_display_name as "author",
    r.text,
    r.base_rating as "baseRating",
    r.criteria,
    r.rating,
    r.objective_rating as "objectiveRating",
    r.timestamp,
    to_char(to_timestamp(r.timestamp / 1000.0) AT TIME ZONE 'UTC', 'DD.MM.YYYY') as "date",
    COALESCE((SELECT count(*)::int FROM public.review_reactions rr WHERE rr.review_id = r.id), 0) AS "reactionCount",
    EXISTS (SELECT 1 FROM public.admins a WHERE a.username = lower(r.author_username)) AS "authorIsAdmin"
FROM public.reviews r;

-- Представление для комментариев с флагом админа
CREATE OR REPLACE VIEW public.comments_view AS
SELECT 
    c.id,
    c.review_id as "reviewId",
    c.author_id as "authorId",
    c.author_username as "authorUsername",
    c.author_display_name as "author",
    c.text,
    c.timestamp,
    to_char(to_timestamp(c.timestamp / 1000.0) AT TIME ZONE 'UTC', 'DD.MM.YYYY') as "date",
    EXISTS (SELECT 1 FROM public.admins a WHERE a.username = lower(c.author_username)) AS "authorIsAdmin"
FROM public.review_comments c;

-- ==========================================
-- ROW LEVEL SECURITY (RLS) ПОЛИТИКИ БЕЗОПАСНОСТИ
-- ==========================================

-- Включаем RLS на всех таблицах
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_subscribers ENABLE ROW LEVEL SECURITY;

-- 0. Политики для admins
CREATE POLICY select_admins ON public.admins 
    FOR SELECT TO public USING (true);

-- 1. Политики для releases
CREATE POLICY select_releases ON public.releases 
    FOR SELECT TO public USING (true);

CREATE POLICY admin_all_releases ON public.releases 
    FOR ALL TO authenticated 
    USING ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
    WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- 2. Политики для reviews
CREATE POLICY select_reviews ON public.reviews 
    FOR SELECT TO public USING (true);

CREATE POLICY insert_reviews ON public.reviews 
    FOR INSERT TO authenticated 
    WITH CHECK (author_id = (auth.jwt() ->> 'sub')::bigint);

CREATE POLICY update_reviews ON public.reviews 
    FOR UPDATE TO authenticated 
    USING (author_id = (auth.jwt() ->> 'sub')::bigint)
    WITH CHECK (author_id = (auth.jwt() ->> 'sub')::bigint);

CREATE POLICY delete_reviews ON public.reviews 
    FOR DELETE TO authenticated 
    USING (author_id = (auth.jwt() ->> 'sub')::bigint OR (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- 3. Политики для review_comments
CREATE POLICY select_comments ON public.review_comments 
    FOR SELECT TO public USING (true);

CREATE POLICY insert_comments ON public.review_comments 
    FOR INSERT TO authenticated 
    WITH CHECK (author_id = (auth.jwt() ->> 'sub')::bigint);

CREATE POLICY delete_comments ON public.review_comments 
    FOR DELETE TO authenticated 
    USING (author_id = (auth.jwt() ->> 'sub')::bigint OR (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- 4. Политики для likes
CREATE POLICY select_likes ON public.likes 
    FOR SELECT TO public USING (true);

CREATE POLICY insert_likes ON public.likes 
    FOR INSERT TO authenticated 
    WITH CHECK (user_id = (auth.jwt() ->> 'sub')::bigint);

CREATE POLICY delete_likes ON public.likes 
    FOR DELETE TO authenticated 
    USING (user_id = (auth.jwt() ->> 'sub')::bigint);

-- 5. Политики для review_reactions
CREATE POLICY select_reactions ON public.review_reactions 
    FOR SELECT TO public USING (true);

CREATE POLICY insert_reactions ON public.review_reactions 
    FOR INSERT TO authenticated 
    WITH CHECK (user_id = (auth.jwt() ->> 'sub')::bigint);

CREATE POLICY delete_reactions ON public.review_reactions 
    FOR DELETE TO authenticated 
    USING (user_id = (auth.jwt() ->> 'sub')::bigint);

-- 6. Политики для blocked_users
CREATE POLICY select_blocked ON public.blocked_users 
    FOR SELECT TO authenticated USING (true);

CREATE POLICY admin_all_blocked ON public.blocked_users 
    FOR ALL TO authenticated 
    USING ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
    WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- 7. Политики для notification_subscribers
CREATE POLICY select_subscribers ON public.notification_subscribers 
    FOR SELECT TO authenticated 
    USING (user_id = (auth.jwt() ->> 'sub')::bigint OR (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

CREATE POLICY all_subscribers ON public.notification_subscribers 
    FOR ALL TO authenticated 
    USING (user_id = (auth.jwt() ->> 'sub')::bigint)
    WITH CHECK (user_id = (auth.jwt() ->> 'sub')::bigint);
