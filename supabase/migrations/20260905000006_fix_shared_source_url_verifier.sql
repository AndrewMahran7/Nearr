-- PostgreSQL standard-conforming strings need a single regex escape. Keep the
-- verifier definition explicit so the already-migrated Dev project and fresh
-- Production application converge on the same strict provider URL policy.
create or replace function public.is_saved_place_source_public_shareable(
  p_source_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.saved_place_sources src
      join public.share_job_place_results result
        on result.saved_place_id = src.saved_place_id
       and result.user_id = src.user_id
       and result.outcome in ('auto_saved', 'already_saved')
      join public.share_jobs job
        on job.id = result.share_job_id
       and job.user_id = src.user_id
       and job.status = 'completed'
     where src.id = p_source_id
       and src.platform in ('instagram', 'tiktok', 'facebook')
       and src.identity_version > 0
       and src.identity_key = job.recognition_identity_key
       and src.identity_key like 'v' || src.identity_version::text || ':' || src.platform || ':%'
       and src.canonical_url ~ '^https://'
       and (
         (src.platform = 'instagram'
           and src.canonical_url ~* '^https://(www\.)?instagram\.com/(p|reel)/[A-Za-z0-9_-]+/?$')
         or (src.platform = 'tiktok'
           and src.canonical_url ~* '^https://(www\.)?tiktok\.com/@[^/?#]+/video/[0-9]+/?$')
         or (src.platform = 'facebook'
           and src.canonical_url ~* '^https://(www\.)?facebook\.com/reel/[0-9]+/?$')
       )
       and lower(src.canonical_url) !~ '(localhost|127\.0\.0\.1|benchmark|fixture|example\.(com|org|net))'
  );
$$;

revoke all on function public.is_saved_place_source_public_shareable(uuid)
  from public, anon, authenticated;
grant execute on function public.is_saved_place_source_public_shareable(uuid)
  to service_role;
