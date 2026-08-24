-- Bounded private evidence frames for Vayrin Quick Check.
--
-- The worker uploads at most five <=768 KiB JPEGs under:
--   <user_id>/<share_job_id>/<media_task_id>/<index>-<timestamp>.jpg
-- References live in share_jobs.candidate_payload.evidenceFrames. The bucket is
-- private; an authenticated client may sign/delete only objects belonging to a
-- share job it owns. Removing the job through the app removes the referenced
-- objects first. No extracted video/audio or unselected frames are retained.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'share-evidence',
  'share-evidence',
  false,
  786432,
  array['image/jpeg']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "owners read share evidence" on storage.objects;
create policy "owners read share evidence"
on storage.objects for select
to authenticated
using (
  bucket_id = 'share-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1
      from public.share_jobs sj
     where sj.id::text = (storage.foldername(name))[2]
       and sj.user_id = auth.uid()
  )
);

drop policy if exists "owners delete share evidence" on storage.objects;
create policy "owners delete share evidence"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'share-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1
      from public.share_jobs sj
     where sj.id::text = (storage.foldername(name))[2]
       and sj.user_id = auth.uid()
  )
);
