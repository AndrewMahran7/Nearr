-- Keep recognition source geography separate from the AI-note evidence array.
-- The previous Edge writer attempted to store an object/null in
-- evidence_snapshot, whose current contract is a non-null JSON array.

alter table public.share_media_tasks
  add column if not exists source_geography jsonb;

alter table public.share_media_tasks
  drop constraint if exists share_media_tasks_source_geography_check;

alter table public.share_media_tasks
  add constraint share_media_tasks_source_geography_check
  check (
    source_geography is null
    or (
      jsonb_typeof(source_geography) = 'object'
      and octet_length(source_geography::text) <= 4000
    )
  );

comment on column public.share_media_tasks.source_geography is
  'Bounded source-location evidence for recognition; never candidate geography or AI-note evidence.';
