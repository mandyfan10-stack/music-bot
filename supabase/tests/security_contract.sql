begin;

create extension if not exists pgtap with schema extensions;
select plan(39);

select is(
  (select public from storage.buckets where id = 'release-covers'),
  true,
  'release cover bucket is publicly readable'
);
select is(
  (select file_size_limit from storage.buckets where id = 'release-covers'),
  2097152::bigint,
  'release cover uploads are capped at two megabytes'
);
select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and coalesce(qual, '') || coalesce(with_check, '') ilike '%release-covers%'
  ),
  0::bigint,
  'release cover writes have no client RLS policy'
);

select has_function(
  'public',
  'tr_send_release_notification',
  array[]::text[],
  'notification webhook function is installed'
);
select has_trigger(
  'public',
  'releases',
  'tr_releases_insert_notification',
  'release notification trigger is installed'
);

select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'dev_create_release'
  ),
  0::bigint,
  'unauthenticated development release creation RPC is absent'
);
select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'dev_delete_release'
  ),
  0::bigint,
  'unauthenticated development release deletion RPC is absent'
);

insert into public.releases (id, name, artist, link)
values ('release-1', 'Release', 'Artist', 'https://example.com/release');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000200","role":"authenticated","app_metadata":{"telegram_user_id":"200","username":"Alice","display_name":"Alice"}}',
  true
);
set local role authenticated;

select lives_ok(
  $$select public.create_review(
    'release-1',
    repeat('A secure review. ', 3),
    8,
    '{"sound":4,"production":4,"originality":4,"meaning":4,"relevance":4,"image":4}'::jsonb
  )$$,
  'an authenticated user can create a review through the RPC'
);
select is(
  (select author_id from public.reviews where release_id = 'release-1'),
  200::bigint,
  'review author comes from JWT sub'
);
select is(
  (select author_username from public.reviews where release_id = 'release-1'),
  'alice',
  'review username is normalized from current JWT metadata'
);
select is(
  (select objective_rating from public.reviews where release_id = 'release-1'),
  4.0::numeric,
  'objective rating is calculated by the database'
);
select is(
  (select rating from public.reviews where release_id = 'release-1'),
  6.0::numeric,
  'final rating is calculated by the database'
);
select throws_ok(
  $$select public.create_review(
    'release-1',
    repeat('A second review. ', 3),
    9,
    '{"sound":5,"production":5,"originality":5,"meaning":5,"relevance":5,"image":5}'::jsonb
  )$$,
  '23505',
  'duplicate key value violates unique constraint "idx_reviews_release_author"',
  'a second review for the same release and author is rejected'
);
select throws_ok(
  $$select public.create_review(
    'release-1',
    repeat('An invalid review. ', 3),
    9,
    '{"sound":5,"production":5,"originality":5,"meaning":5,"relevance":5,"image":5,"extra":5}'::jsonb
  )$$,
  'P0001',
  'Exactly six rating criteria are required',
  'criteria must contain exactly the six supported keys'
);

reset role;
insert into public.releases (id, name, artist, link)
values ('release-2', 'Named', 'Artist', 'https://example.com/named');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000202","role":"authenticated","app_metadata":{"telegram_user_id":"202","username":"Cara","display_name":"Cara"}}',
  true
);
set local role authenticated;
select lives_ok(
  $$select public.create_review(
    'release-2',
    repeat('A named review. ', 3),
    7,
    '{"sound":3,"production":3,"originality":3,"meaning":3,"relevance":3,"image":3}'::jsonb,
    'client-review-id-202'
  )$$,
  'create_review accepts a client-supplied id'
);
select is(
  (select id from public.reviews where author_id = 202),
  'client-review-id-202',
  'review id matches the client-supplied value'
);
select lives_ok(
  $$select public.create_comment(
    'client-review-id-202',
    'hello from the client id path',
    'client-comment-id-202'
  )$$,
  'create_comment accepts a client-supplied id'
);
select is(
  (select id from public.review_comments where author_id = 202),
  'client-comment-id-202',
  'comment id matches the client-supplied value'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000200","role":"authenticated","app_metadata":{"telegram_user_id":"200","username":"Alice","display_name":"Alice"}}',
  true
);
set local role authenticated;

insert into public.likes (release_id, user_id, username)
values ('release-1', 999, 'forged');
select is(
  (select user_id from public.likes where release_id = 'release-1'),
  200::bigint,
  'like user ID is overwritten from JWT sub'
);
select is(
  (select username from public.likes where release_id = 'release-1'),
  'alice',
  'like username is overwritten from JWT metadata'
);

insert into public.review_reactions (review_id, user_id, username)
values (
  (select id from public.reviews where release_id = 'release-1'),
  999,
  'forged'
);
select is(
  (select user_id from public.review_reactions limit 1),
  200::bigint,
  'reaction user ID is overwritten from JWT sub'
);
select is(
  (select "reactionCount" from public.reviews_view where "relId" = 'release-1'),
  1,
  'public review view exposes the aggregate reaction count'
);
select is(
  (select author_id from public.reviews where release_id = 'release-1'),
  200::bigint,
  'reaction-count maintenance preserves review ownership'
);

reset role;
insert into public.blocked_users (user_id, username) values (200, 'alice');
set local role authenticated;

select is(
  (select count(*) from public.blocked_users),
  1::bigint,
  'a blocked user can see their own block record'
);
delete from public.likes where release_id = 'release-1';
select is(
  (select count(*) from public.likes where release_id = 'release-1'),
  1::bigint,
  'blocking takes effect immediately for an already-issued JWT'
);
select throws_ok(
  $$select public.create_comment(
    (select id from public.reviews where release_id = 'release-1'),
    'blocked'
  )$$,
  'P0001',
  'Active authenticated Telegram user required',
  'a blocked user cannot create a comment'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000201","role":"authenticated","app_metadata":{"telegram_user_id":"201","username":"Bob","display_name":"Bob"}}',
  true
);
set local role authenticated;
select is(
  (select count(*) from public.blocked_users),
  0::bigint,
  'a regular user cannot enumerate blocked users'
);
select is(
  (select count(*) from public.likes),
  0::bigint,
  'a regular user cannot enumerate another user likes'
);
select is(
  (select count(*) from public.review_reactions),
  0::bigint,
  'a regular user cannot enumerate another user reactions'
);
select is(
  (select "reactionCount" from public.reviews_view where "relId" = 'release-1'),
  1,
  'aggregate reaction counts remain visible to regular users'
);

reset role;
insert into public.admins (user_id, username) values (100, 'owner');
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000100","role":"authenticated","app_metadata":{"telegram_user_id":"100","username":"Owner","display_name":"Owner"}}',
  true
);
set local role authenticated;
select ok(public.current_user_is_admin(), 'admin access is read from the current table');
select lives_ok(
  $$select public.admin_set_block(201, true)$$,
  'an admin can block a stable Telegram user ID'
);
select is(
  (select count(*) from public.blocked_users where user_id = 201),
  1::bigint,
  'admin block is stored by Telegram user ID'
);
select is(
  public.admin_delete_reviews(201),
  0,
  'admin review deletion returns a defined count'
);

reset role;
delete from public.admins where user_id = 100;
set local role authenticated;
select ok(
  not public.current_user_is_admin(),
  'deleting the admin row revokes access for an already-issued JWT'
);

reset role;
set local role anon;
select is(
  (select count(*) from public.likes),
  0::bigint,
  'anonymous users cannot enumerate like identities'
);
select is(
  (select count(*) from public.review_reactions),
  0::bigint,
  'anonymous users cannot enumerate reaction identities'
);
select is(
  (select "reactionCount" from public.reviews_view where "relId" = 'release-1'),
  1,
  'aggregate reaction counts remain publicly readable'
);
select throws_ok(
  $$select public.create_comment('missing-review', 'anonymous')$$,
  '42501',
  'permission denied for function create_comment',
  'anon cannot execute write RPCs'
);

select * from finish();
rollback;
