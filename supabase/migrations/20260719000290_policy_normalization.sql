-- Split FOR ALL policies so SELECT uses one equivalent permissive policy.

DROP POLICY IF EXISTS admin_all_releases ON public.releases;
CREATE POLICY admin_insert_releases ON public.releases
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_admin());
CREATE POLICY admin_update_releases ON public.releases
  FOR UPDATE TO authenticated
  USING (public.current_user_is_admin())
  WITH CHECK (public.current_user_is_admin());
CREATE POLICY admin_delete_releases ON public.releases
  FOR DELETE TO authenticated
  USING (public.current_user_is_admin());

DROP POLICY IF EXISTS admin_all_blocked ON public.blocked_users;
CREATE POLICY admin_insert_blocked ON public.blocked_users
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_admin());
CREATE POLICY admin_update_blocked ON public.blocked_users
  FOR UPDATE TO authenticated
  USING (public.current_user_is_admin())
  WITH CHECK (public.current_user_is_admin());
CREATE POLICY admin_delete_blocked ON public.blocked_users
  FOR DELETE TO authenticated
  USING (public.current_user_is_admin());

DROP POLICY IF EXISTS all_subscribers ON public.notification_subscribers;
CREATE POLICY self_insert_subscribers ON public.notification_subscribers
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = public.current_telegram_user_id()
    AND NOT public.current_user_is_blocked()
  );
CREATE POLICY self_update_subscribers ON public.notification_subscribers
  FOR UPDATE TO authenticated
  USING (
    user_id = public.current_telegram_user_id()
    AND NOT public.current_user_is_blocked()
  )
  WITH CHECK (
    user_id = public.current_telegram_user_id()
    AND NOT public.current_user_is_blocked()
  );
CREATE POLICY self_delete_subscribers ON public.notification_subscribers
  FOR DELETE TO authenticated
  USING (
    user_id = public.current_telegram_user_id()
    AND NOT public.current_user_is_blocked()
  );
