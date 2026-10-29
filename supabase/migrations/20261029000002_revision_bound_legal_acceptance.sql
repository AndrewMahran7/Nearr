-- Bind the user's explicit action to the account and revisions they saw.
-- A policy update while the screen is open must never accept unseen terms.
create or replace function public.record_global_terms_and_privacy()
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin raise exception 'legal_revision_required'; end; $$;

create or replace function public.record_global_terms_and_privacy(
  p_terms_version text, p_privacy_version text, p_expected_user_id uuid)
returns void language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_policy public.global_release_policy%rowtype;
begin
  if auth.uid() is null or p_expected_user_id is distinct from auth.uid() then
    raise exception 'consent_identity_changed';
  end if;
  select * into v_policy from public.global_release_policy where singleton for share;
  if not found or not v_policy.legal_approved then raise exception 'terms_not_qualified'; end if;
  if p_terms_version is distinct from v_policy.terms_version
    or p_privacy_version is distinct from v_policy.privacy_notice_version then
    raise exception 'legal_revision_changed';
  end if;
  insert into public.account_processing_permissions
    (user_id,terms_version,terms_accepted_at,privacy_notice_version,privacy_notice_seen_at)
  values(auth.uid(),p_terms_version,now(),p_privacy_version,now())
  on conflict(user_id) do update set
    terms_version=excluded.terms_version,terms_accepted_at=excluded.terms_accepted_at,
    privacy_notice_version=excluded.privacy_notice_version,privacy_notice_seen_at=excluded.privacy_notice_seen_at;
end; $$;
revoke all on function public.record_global_terms_and_privacy(text,text,uuid) from public,anon;
grant execute on function public.record_global_terms_and_privacy(text,text,uuid) to authenticated;
