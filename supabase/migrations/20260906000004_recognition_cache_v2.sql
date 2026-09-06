-- Recognition Cache V2: explicit admission, correction quarantine, durable
-- revalidation, independent support, slot-scoped multi-place safety, and
-- compare-and-save protection. Historical recognition_cache rows are retained
-- for audit but are never copied into this V2 boundary.

set check_function_bodies = off;

create table if not exists public.recognition_source_states (
  identity_key text primary key,
  platform text not null check (platform in (
    'tiktok','instagram','youtube','facebook','snapchat','other','unknown'
  )),
  content_id text not null,
  canonical_url text not null,
  identity_version integer not null check (identity_version > 0),
  source_fingerprint text,
  evidence_revision bigint not null default 1 check (evidence_revision > 0),
  feedback_revision bigint not null default 0 check (feedback_revision >= 0),
  policy_version text not null,
  recognition_version text not null,
  state text not null default 'UNVERIFIED' check (state in (
    'UNVERIFIED','ELIGIBLE','QUARANTINED','REVALIDATING','DISPUTED','STALE','REVOKED'
  )),
  whole_source_quarantined boolean not null default false,
  visibility_scope text not null default 'public' check (visibility_scope in ('public','owner')),
  owner_user_id uuid references auth.users(id) on delete cascade,
  source_ai_note text check (char_length(source_ai_note) <= 1000),
  last_invalidation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((visibility_scope = 'owner' and owner_user_id is not null) or
         (visibility_scope = 'public' and owner_user_id is null))
);

create table if not exists public.recognition_cache_answers_v2 (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null references public.recognition_source_states(identity_key) on delete cascade,
  slot_key text not null check (length(trim(slot_key)) between 1 and 160),
  place_id uuid not null references public.places(id) on delete restrict,
  state text not null check (state in (
    'UNVERIFIED','ELIGIBLE','QUARANTINED','REVALIDATING','DISPUTED','STALE','REVOKED'
  )),
  answer_revision bigint not null default 1 check (answer_revision > 0),
  feedback_revision bigint not null default 0 check (feedback_revision >= 0),
  evidence_revision bigint not null default 1 check (evidence_revision > 0),
  policy_version text not null,
  recognition_version text not null,
  source_fingerprint text,
  specificity text not null check (specificity in ('exact','specific_feature')),
  terminal_status text not null check (terminal_status = 'success'),
  semantic_check_passed boolean not null,
  geographic_check_passed boolean not null,
  evidence_sufficient boolean not null,
  strong_contradiction boolean not null default false,
  candidate_snapshot jsonb,
  evidence_summary jsonb,
  admitted_from_job_id uuid references public.share_jobs(id) on delete set null,
  validated_feedback_revision bigint,
  last_validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(identity_key, slot_key),
  check (octet_length(coalesce(candidate_snapshot::text,'')) <= 16384),
  check (octet_length(coalesce(evidence_summary::text,'')) <= 16384),
  check (state <> 'ELIGIBLE' or (
    semantic_check_passed and geographic_check_passed and evidence_sufficient and
    not strong_contradiction and feedback_revision = coalesce(validated_feedback_revision, feedback_revision)
  ))
);

create index if not exists recognition_cache_answers_v2_eligible_idx
  on public.recognition_cache_answers_v2(identity_key, slot_key)
  where state = 'ELIGIBLE';
create index if not exists recognition_cache_answers_v2_place_idx
  on public.recognition_cache_answers_v2(place_id);

create table if not exists public.recognition_correction_events (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 240),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Deliberately not an FK: Wrong Place? deletes the save in the same
  -- transaction while the immutable audit event must retain the historical id.
  saved_place_id uuid,
  identity_key text not null references public.recognition_source_states(identity_key) on delete restrict,
  slot_key text not null,
  previous_place_id uuid not null references public.places(id) on delete restrict,
  replacement_place_id uuid references public.places(id) on delete restrict,
  assertion_kind text not null check (assertion_kind in ('WRONG_PLACE','CORRECTION')),
  feedback_revision bigint not null check (feedback_revision > 0),
  created_at timestamptz not null default now()
);
create index if not exists recognition_correction_events_scope_idx
  on public.recognition_correction_events(identity_key, slot_key, created_at desc);

create table if not exists public.recognition_identity_support (
  user_id uuid not null references auth.users(id) on delete cascade,
  identity_key text not null references public.recognition_source_states(identity_key) on delete cascade,
  slot_key text not null,
  place_id uuid not null references public.places(id) on delete cascade,
  assertion_kind text not null check (assertion_kind in ('CONFIRMATION','CORRECTION')),
  source_event_id uuid references public.recognition_correction_events(id) on delete set null,
  asserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id, identity_key, slot_key)
);
create index if not exists recognition_identity_support_tally_idx
  on public.recognition_identity_support(identity_key, slot_key, place_id);

create table if not exists public.recognition_revalidation_tasks (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null references public.recognition_source_states(identity_key) on delete cascade,
  slot_key text not null,
  correction_event_id uuid not null references public.recognition_correction_events(id) on delete cascade,
  previous_place_id uuid not null references public.places(id) on delete restrict,
  replacement_place_id uuid references public.places(id) on delete restrict,
  feedback_revision bigint not null check (feedback_revision > 0),
  evidence_revision bigint not null check (evidence_revision > 0),
  policy_version text not null,
  state text not null default 'QUEUED' check (state in (
    'QUEUED','PROCESSING','RETRY_WAIT','COMPLETED','FAILED','STALE'
  )),
  attempts integer not null default 0 check (attempts between 0 and 3),
  max_attempts integer not null default 3 check (max_attempts between 1 and 3),
  next_attempt_at timestamptz not null default now(),
  decision text check (decision is null or decision in (
    'AGREES_WITH_REPLACEMENT','SUPPORTS_PREVIOUS','SUPPORTS_OTHER',
    'INSUFFICIENT_EVIDENCE','TECHNICAL_FAILURE'
  )),
  supported_place_id uuid references public.places(id) on delete set null,
  diagnostics jsonb not null default '{}'::jsonb check (octet_length(diagnostics::text) <= 8192),
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(identity_key, slot_key, feedback_revision)
);
create index if not exists recognition_revalidation_tasks_ready_idx
  on public.recognition_revalidation_tasks(next_attempt_at, created_at)
  where state in ('QUEUED','RETRY_WAIT');

alter table public.share_media_tasks
  add column if not exists recognition_revalidation_task_id uuid
    references public.recognition_revalidation_tasks(id) on delete cascade;

alter table public.share_media_tasks drop constraint if exists share_media_tasks_task_kind_check;
alter table public.share_media_tasks add constraint share_media_tasks_task_kind_check
  check (task_kind in ('recognition','premium_recognition','ai_note_enrichment','recognition_revalidation'));
alter table public.share_media_tasks drop constraint if exists share_media_tasks_target_check;
alter table public.share_media_tasks drop constraint if exists share_media_tasks_kind_shape_check;
alter table public.share_media_tasks add constraint share_media_tasks_kind_shape_check check (
  (task_kind in ('recognition','premium_recognition') and share_job_id is not null and
    saved_place_id is null and target_place_id is null and recognition_revalidation_task_id is null)
  or
  (task_kind = 'ai_note_enrichment' and share_job_id is null and
    saved_place_id is not null and target_place_id is not null and recognition_revalidation_task_id is null)
  or
  (task_kind = 'recognition_revalidation' and share_job_id is null and
    saved_place_id is null and target_place_id is null and recognition_revalidation_task_id is not null)
);
alter table public.share_media_tasks drop constraint if exists share_media_tasks_premium_shape_check;
alter table public.share_media_tasks drop constraint if exists share_media_tasks_premium_identity_check;
alter table public.share_media_tasks add constraint share_media_tasks_premium_shape_check check (
  (task_kind = 'premium_recognition' and premium_request_id is not null)
  or (task_kind <> 'premium_recognition' and premium_request_id is null)
);
create unique index if not exists share_media_tasks_active_revalidation_idx
  on public.share_media_tasks(recognition_revalidation_task_id)
  where task_kind = 'recognition_revalidation' and status in ('queued','processing');

-- The owner of a revalidation task is always derived from the immutable
-- correction event. No client can choose a source or another user's identity.
create or replace function public.share_media_tasks_enforce_owner()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid; v_target uuid; v_premium_id uuid;
begin
  if new.task_kind in ('recognition','premium_recognition') then
    select sj.user_id,sj.premium_request_id into v_owner,v_premium_id
      from public.share_jobs sj where sj.id=new.share_job_id;
    if v_owner is null then raise exception 'share_media_tasks: parent share_job % not found',new.share_job_id; end if;
    if new.task_kind='premium_recognition' and new.premium_request_id is distinct from v_premium_id then
      raise exception 'share_media_tasks: premium request mismatch';
    end if;
  elsif new.task_kind='ai_note_enrichment' then
    select sp.user_id,sp.place_id into v_owner,v_target from public.saved_places sp where sp.id=new.saved_place_id;
    if v_owner is null or v_target is distinct from new.target_place_id then
      raise exception 'share_media_tasks: invalid ai note target';
    end if;
  elsif new.task_kind='recognition_revalidation' then
    select ce.user_id into v_owner
      from public.recognition_revalidation_tasks rt
      join public.recognition_correction_events ce on ce.id=rt.correction_event_id
     where rt.id=new.recognition_revalidation_task_id;
    if v_owner is null then raise exception 'share_media_tasks: invalid revalidation target'; end if;
  else
    raise exception 'share_media_tasks: invalid task_kind %',new.task_kind;
  end if;
  if new.user_id is distinct from v_owner then raise exception 'share_media_tasks: owner mismatch'; end if;
  return new;
end;
$$;

-- Correction events are audit history, never mutable consensus counters.
create or replace function public.reject_recognition_correction_event_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'recognition_correction_events_are_immutable';
end;
$$;
drop trigger if exists recognition_correction_events_immutable on public.recognition_correction_events;
-- No mutation privilege is granted to clients. Avoid a DELETE trigger because
-- it would also block the existing auth.users ON DELETE CASCADE privacy path.

create or replace function public.queue_recognition_revalidation_media_task(p_task_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_task public.recognition_revalidation_tasks%rowtype;
declare v_source public.recognition_source_states%rowtype;
declare v_user_id uuid;
begin
  select * into v_task from public.recognition_revalidation_tasks where id=p_task_id for update;
  if v_task.id is null or v_task.state not in ('QUEUED','RETRY_WAIT') or v_task.next_attempt_at > now() then return false; end if;
  select * into v_source from public.recognition_source_states where identity_key=v_task.identity_key;
  select ce.user_id into v_user_id from public.recognition_correction_events ce where ce.id=v_task.correction_event_id;
  if v_source.identity_key is null or v_user_id is null then return false; end if;
  if exists(select 1 from public.share_media_tasks mt where mt.recognition_revalidation_task_id=v_task.id
    and mt.status in ('queued','processing')) then return false; end if;
  insert into public.share_media_tasks(
    task_kind,recognition_revalidation_task_id,user_id,source_url,canonical_url,
    platform,status,progress_stage,max_attempts,next_attempt_at
  ) values (
    'recognition_revalidation',v_task.id,v_user_id,v_source.canonical_url,v_source.canonical_url,
    v_source.platform,'queued','queued',3,now()
  );
  update public.recognition_revalidation_tasks set state='QUEUED',updated_at=now() where id=v_task.id;
  return true;
end;
$$;

-- Include durable correction revalidation jobs in the existing queue claim.
-- The network/model call happens only after this short SKIP LOCKED claim.
create or replace function public.claim_media_tasks(
  p_limit integer default 2,p_lock_seconds integer default 600
)
returns setof public.share_media_tasks language plpgsql security definer set search_path=public,pg_temp as $$
begin
  return query update public.share_media_tasks mt set
    status='processing',attempts=mt.attempts+1,locked_at=now(),
    locked_until=now()+make_interval(secs=>greatest(p_lock_seconds,60)),
    progress_stage=coalesce(mt.progress_stage,'queued'),updated_at=now()
  where mt.id in (
    select c.id from public.share_media_tasks c
    where c.attempts<c.max_attempts and (c.next_attempt_at is null or c.next_attempt_at<=now())
      and (c.status='queued' or (c.status='processing' and c.locked_until is not null and c.locked_until<now()))
      and (
        (c.task_kind in ('recognition','premium_recognition') and exists(
          select 1 from public.share_jobs sj where sj.id=c.share_job_id and (
            sj.status='processing_metadata' or
            (c.task_kind='recognition' and sj.status='completed' and sj.saved_place_id is not null)
          )
        )) or
        (c.task_kind='ai_note_enrichment' and exists(
          select 1 from public.saved_places sp where sp.id=c.saved_place_id
            and sp.user_id=c.user_id and sp.place_id=c.target_place_id
            and sp.source_url=coalesce(c.canonical_url,c.source_url)
            and public.is_video_derived_saved_place(sp.source_type,sp.source_url)
            and coalesce(length(trim(sp.ai_note)),0)=0
        )) or
        (c.task_kind='recognition_revalidation' and exists(
          select 1 from public.recognition_revalidation_tasks rt
           where rt.id=c.recognition_revalidation_task_id
             and rt.state in ('QUEUED','RETRY_WAIT','PROCESSING') and rt.next_attempt_at<=now()
        ))
      )
    order by c.created_at for update skip locked limit greatest(p_limit,1)
  ) returning mt.*;
end;
$$;

create or replace function public.recover_abandoned_recognition_revalidations_v2(p_limit integer default 25)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row record; v_count integer:=0;
begin
  for v_row in
    select rt.id,rt.identity_key from public.recognition_revalidation_tasks rt
    where rt.state='PROCESSING' and exists(
      select 1 from public.share_media_tasks mt
       where mt.recognition_revalidation_task_id=rt.id and mt.status in ('failed','cancelled')
    ) order by rt.updated_at for update skip locked limit greatest(p_limit,1)
  loop
    update public.recognition_revalidation_tasks set state='FAILED',decision='TECHNICAL_FAILURE',
      last_error_code='revalidation_worker_abandoned',completed_at=now(),updated_at=now()
      where id=v_row.id and state='PROCESSING';
    update public.recognition_source_states set state='QUARANTINED',updated_at=now()
      where identity_key=v_row.identity_key;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

drop trigger if exists share_media_tasks_owner_guard on public.share_media_tasks;
create trigger share_media_tasks_owner_guard
  before insert or update of user_id,share_job_id,saved_place_id,target_place_id,task_kind,recognition_revalidation_task_id
  on public.share_media_tasks for each row execute function public.share_media_tasks_enforce_owner();

create or replace function public.queue_ready_recognition_revalidations(p_limit integer default 10)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_count integer:=0;
begin
  for v_id in select rt.id from public.recognition_revalidation_tasks rt
    where rt.state in ('QUEUED','RETRY_WAIT') and rt.next_attempt_at<=now()
    order by rt.created_at for update skip locked limit least(greatest(p_limit,1),25)
  loop
    if public.queue_recognition_revalidation_media_task(v_id) then v_count:=v_count+1; end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.apply_recognition_feedback_v2(
  p_saved_place_id uuid,
  p_previous_place_id uuid,
  p_replacement_place_id uuid,
  p_reason text,
  p_idempotency_key text default null
)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid:=auth.uid(); v_owner uuid; v_source record; v_answer record; v_answer_count integer;
  v_scope text; v_revision bigint; v_event_id uuid; v_task_id uuid;
  v_key text; v_count integer:=0; v_existing uuid;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  if p_reason not in ('wrong_place','corrected_place') then raise exception 'invalid_rejection_reason'; end if;
  -- The correction trigger runs after saved_places.place_id changes, so ownership
  -- must be checked by row id. The caller/trigger supplies the locked OLD value.
  select sp.user_id into v_owner from public.saved_places sp
   where sp.id=p_saved_place_id for update;
  if v_owner is null or v_owner is distinct from v_uid then raise exception 'saved_place_not_owned'; end if;
  if p_reason='corrected_place' and p_replacement_place_id is null then raise exception 'replacement_required'; end if;
  if p_replacement_place_id is not null and
     public.resolve_public_place_id(p_previous_place_id)=public.resolve_public_place_id(p_replacement_place_id)
    then raise exception 'replacement_matches_previous'; end if;

  -- Bound paid-work amplification while allowing exact idempotent replays.
  if p_idempotency_key is not null then
    select ce.id into v_existing from public.recognition_correction_events ce
     where ce.user_id=v_uid and (ce.idempotency_key=p_idempotency_key or
       ce.idempotency_key like left(p_idempotency_key,200)||':%') limit 1;
    if v_existing is not null then return 0; end if;
  end if;
  if (select count(*) from public.recognition_correction_events ce
       where ce.user_id=v_uid and ce.created_at>now()-interval '1 hour') >= 20
    then raise exception 'recognition_feedback_rate_limited'; end if;

  for v_source in
    select s.* from public.saved_place_sources s
     where s.saved_place_id=p_saved_place_id and s.user_id=v_uid
     order by s.identity_key for update
  loop
    insert into public.recognition_source_states(
      identity_key,platform,content_id,canonical_url,identity_version,
      policy_version,recognition_version,state,whole_source_quarantined,last_invalidation_reason
    ) values (
      v_source.identity_key,
      case when v_source.platform in ('tiktok','instagram','youtube','facebook','snapchat') then v_source.platform else 'other' end,
      v_source.content_id,v_source.canonical_url,v_source.identity_version,
      'recognition-cache-v2.1','vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups',
      'QUARANTINED',false,p_reason
    ) on conflict(identity_key) do nothing;

    select count(*) into v_answer_count from public.recognition_cache_answers_v2 a
     where a.identity_key=v_source.identity_key
       and public.resolve_public_place_id(a.place_id)=public.resolve_public_place_id(p_previous_place_id);
    select a.* into v_answer from public.recognition_cache_answers_v2 a
     where a.identity_key=v_source.identity_key
       and public.resolve_public_place_id(a.place_id)=public.resolve_public_place_id(p_previous_place_id)
     order by a.slot_key limit 1 for update;
    v_scope:=case when v_answer_count=1 then v_answer.slot_key else '*' end;

    update public.recognition_source_states ss set
      feedback_revision=ss.feedback_revision+1,
      state='QUARANTINED',
      whole_source_quarantined=ss.whole_source_quarantined or v_scope='*',
      last_invalidation_reason=p_reason,updated_at=now()
     where ss.identity_key=v_source.identity_key returning feedback_revision into v_revision;

    -- The source revision advances for every slot. Known-scope corrections
    -- quarantine only that slot while carrying unaffected siblings forward at
    -- the new revision. The source gate blocks partial completion until the
    -- affected slot has a terminal validation outcome.
    if v_scope='*' then
      update public.recognition_cache_answers_v2 set state='QUARANTINED',
        feedback_revision=v_revision,answer_revision=answer_revision+1,updated_at=now()
       where identity_key=v_source.identity_key and state<>'REVOKED';
    else
      update public.recognition_cache_answers_v2 set state='QUARANTINED',
        feedback_revision=v_revision,answer_revision=answer_revision+1,updated_at=now()
       where id=v_answer.id;
      update public.recognition_cache_answers_v2 set
        feedback_revision=v_revision,
        validated_feedback_revision=case when state='ELIGIBLE' then v_revision else validated_feedback_revision end,
        answer_revision=answer_revision+1,updated_at=now()
       where identity_key=v_source.identity_key and id<>v_answer.id and state<>'REVOKED';
    end if;
    -- Legacy reads are retired, but invalidate old rows too so rollback cannot
    -- accidentally resurrect the result.
    update public.recognition_cache set invalidated_at=now(),invalidation_reason='user_correction',
      dispute_count=dispute_count+1 where identity_key=v_source.identity_key;
    insert into public.recognition_rejections(
      user_id,identity_key,identity_version,canonical_place_id,google_place_id,
      source_saved_place_id,reason,rejected_at
    ) select v_uid,v_source.identity_key,v_source.identity_version,p_previous_place_id,
      p.google_place_id,p_saved_place_id,p_reason,now() from public.places p where p.id=p_previous_place_id
    on conflict(user_id,identity_key,canonical_place_id) do update set
      google_place_id=coalesce(excluded.google_place_id,public.recognition_rejections.google_place_id),
      source_saved_place_id=excluded.source_saved_place_id,reason=excluded.reason,
      rejected_at=excluded.rejected_at,updated_at=now();

    v_key:=coalesce(nullif(trim(p_idempotency_key),''),
      'legacy:'||p_saved_place_id::text||':'||p_previous_place_id::text||':'||
      coalesce(p_replacement_place_id::text,'none'))||':'||md5(v_source.identity_key||':'||v_scope);
    insert into public.recognition_correction_events(
      idempotency_key,user_id,saved_place_id,identity_key,slot_key,previous_place_id,
      replacement_place_id,assertion_kind,feedback_revision
    ) values (
      left(v_key,240),v_uid,p_saved_place_id,v_source.identity_key,v_scope,p_previous_place_id,
      p_replacement_place_id,case when p_replacement_place_id is null then 'WRONG_PLACE' else 'CORRECTION' end,v_revision
    ) on conflict(idempotency_key) do nothing returning id into v_event_id;
    if v_event_id is null then continue; end if;

    if p_replacement_place_id is not null then
      insert into public.recognition_identity_support(user_id,identity_key,slot_key,place_id,assertion_kind,source_event_id)
      values(v_uid,v_source.identity_key,v_scope,public.resolve_public_place_id(p_replacement_place_id),'CORRECTION',v_event_id)
      on conflict(user_id,identity_key,slot_key) do update set
        place_id=excluded.place_id,assertion_kind='CORRECTION',source_event_id=excluded.source_event_id,
        asserted_at=now(),updated_at=now();
    else
      perform set_config('nearr.suppress_support_delete_recompute','on',true);
      delete from public.recognition_identity_support s where s.user_id=v_uid
        and s.identity_key=v_source.identity_key and s.slot_key=v_scope;
      perform set_config('nearr.suppress_support_delete_recompute','off',true);
    end if;

    insert into public.recognition_revalidation_tasks(
      identity_key,slot_key,correction_event_id,previous_place_id,replacement_place_id,
      feedback_revision,evidence_revision,policy_version
    ) select v_source.identity_key,v_scope,v_event_id,p_previous_place_id,p_replacement_place_id,
      v_revision,ss.evidence_revision,ss.policy_version
      from public.recognition_source_states ss where ss.identity_key=v_source.identity_key
    on conflict(identity_key,slot_key,feedback_revision) do nothing returning id into v_task_id;
    if v_task_id is not null then perform public.queue_recognition_revalidation_media_task(v_task_id); end if;
    v_count:=v_count+1;
  end loop;
  if v_count=0 then raise exception 'recognition_source_missing'; end if;
  return v_count;
end;
$$;

-- Supported old clients still call the existing correction RPC. The existing
-- update trigger invokes this helper in the same transaction, using a stable
-- derived idempotency key when the new client did not set one.
create or replace function public.dispute_recognition_after_place_correction()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_key text;
begin
  if old.place_id is not distinct from new.place_id or auth.uid() is null or auth.uid() is distinct from new.user_id then return new; end if;
  v_key:=nullif(current_setting('nearr.correction_idempotency_key',true),'');
  perform public.apply_recognition_feedback_v2(new.id,old.place_id,new.place_id,'corrected_place',v_key);
  return new;
end;
$$;

-- Recreate the legacy-named trigger defensively. Replacing the function keeps
-- existing installs current; recreating the trigger also repairs an install
-- where the historical trigger was removed or disabled during maintenance.
drop trigger if exists saved_places_dispute_recognition on public.saved_places;
create trigger saved_places_dispute_recognition
  after update of place_id on public.saved_places
  for each row execute function public.dispute_recognition_after_place_correction();

create or replace function public.correct_saved_place_provider_v2(
  p_saved_place_id uuid,p_place_id uuid,p_corrected_google_place_id text,
  p_category text,p_category_source text,p_category_confidence numeric,
  p_category_model_version text,p_idempotency_key text
)
returns table(saved_place_id uuid,merged_saved_place_id uuid,source_job_id uuid,source_result_id uuid,source_rule_version text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if coalesce(length(trim(p_idempotency_key)),0) not between 8 and 200 then raise exception 'invalid_idempotency_key'; end if;
  perform set_config('nearr.correction_idempotency_key',trim(p_idempotency_key),true);
  return query select * from public.correct_saved_place_provider(
    p_saved_place_id,p_place_id,p_corrected_google_place_id,p_category,p_category_source,
    p_category_confidence,p_category_model_version);
end;
$$;

create or replace function public.reject_saved_place_recognition_v2(
  p_saved_place_id uuid,p_reason text,p_idempotency_key text
)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_place_id uuid; v_count integer;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if exists(select 1 from public.recognition_correction_events ce where ce.user_id=auth.uid()
    and (ce.idempotency_key=p_idempotency_key or ce.idempotency_key like left(p_idempotency_key,200)||':%'))
    then return 0; end if;
  select sp.place_id into v_place_id from public.saved_places sp
    where sp.id=p_saved_place_id and sp.user_id=auth.uid() for update;
  if v_place_id is null then raise exception 'saved_place_not_found'; end if;
  v_count:=public.apply_recognition_feedback_v2(p_saved_place_id,v_place_id,null,p_reason,p_idempotency_key);
  delete from public.saved_places sp where sp.id=p_saved_place_id and sp.user_id=auth.uid();
  return v_count;
end;
$$;

-- Old supported clients receive identical global quarantine semantics.
create or replace function public.reject_saved_place_recognition(
  p_saved_place_id uuid,p_reason text default 'wrong_place'
)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_place_id uuid; v_count integer;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  -- A lost response may cause an old client to retry after this save was
  -- deleted. Recognize the durable assertion before looking up the row.
  if exists(select 1 from public.recognition_correction_events ce
    where ce.user_id=auth.uid() and ce.saved_place_id=p_saved_place_id
      and ce.assertion_kind='WRONG_PLACE') then return 0; end if;
  select sp.place_id into v_place_id from public.saved_places sp
    where sp.id=p_saved_place_id and sp.user_id=auth.uid() for update;
  if v_place_id is null then raise exception 'saved_place_not_found'; end if;
  v_count:=public.apply_recognition_feedback_v2(p_saved_place_id,v_place_id,null,p_reason,null);
  delete from public.saved_places sp where sp.id=p_saved_place_id and sp.user_id=auth.uid();
  return v_count;
end;
$$;

create or replace function public.admit_recognition_answers_v2(
  p_job_id uuid,p_identity_key text,p_platform text,p_content_id text,p_canonical_url text,
  p_identity_version integer,p_policy_version text,p_recognition_version text
)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.share_jobs%rowtype; v_result record; v_state public.recognition_source_states%rowtype;
declare v_count integer:=0; v_fingerprint text; v_source_ai_note text;
begin
  select * into v_job from public.share_jobs where id=p_job_id;
  if v_job.id is null or v_job.status<>'completed' or v_job.saved_place_id is null or
     v_job.failure_category is not null or v_job.failure_code is not null or
     v_job.recognition_identity_key is distinct from p_identity_key
    then return 0; end if;
  -- Cross-user reuse requires an immutable provider content id plus media that
  -- was actually acquired and successfully resolved. URL-only/private sources
  -- and metadata-only guesses remain personal and cache-ineligible.
  if p_identity_key not like 'v'||p_identity_version::text||':%:%' or
     p_platform not in ('tiktok','instagram','youtube','facebook') then return 0; end if;
  select mt.media_sha256 into v_fingerprint from public.share_media_tasks mt
    where mt.share_job_id=p_job_id and mt.task_kind='recognition' and mt.status='completed'
      and mt.media_acquired_once and mt.failure_code is null and mt.media_sha256 is not null
    order by mt.completed_at desc limit 1;
  if v_fingerprint is null then return 0; end if;

  insert into public.recognition_source_states(
    identity_key,platform,content_id,canonical_url,identity_version,source_fingerprint,
    policy_version,recognition_version,state,visibility_scope
  ) values(p_identity_key,p_platform,p_content_id,p_canonical_url,p_identity_version,v_fingerprint,
    p_policy_version,p_recognition_version,'UNVERIFIED','public')
  on conflict(identity_key) do nothing;
  select * into v_state from public.recognition_source_states where identity_key=p_identity_key for update;
  select s.ai_note into v_source_ai_note from public.saved_place_sources s
    where s.saved_place_id=v_job.saved_place_id and s.identity_key=p_identity_key and s.ai_note is not null
    order by s.created_at limit 1;
  if v_source_ai_note is not null then
    update public.recognition_source_states set source_ai_note=left(v_source_ai_note,1000),updated_at=now()
      where identity_key=p_identity_key and visibility_scope='public';
  end if;
  if v_state.source_fingerprint is not null and v_state.source_fingerprint<>v_fingerprint then
    update public.recognition_source_states set state='STALE',evidence_revision=evidence_revision+1,
      last_invalidation_reason='source_fingerprint_changed',updated_at=now() where identity_key=p_identity_key;
    update public.recognition_cache_answers_v2 set state='STALE',answer_revision=answer_revision+1,
      updated_at=now() where identity_key=p_identity_key;
    return 0;
  end if;
  if v_state.feedback_revision>0 or v_state.whole_source_quarantined or
     v_state.state in ('QUARANTINED','REVALIDATING','DISPUTED','STALE','REVOKED') or
     v_state.policy_version<>p_policy_version or v_state.recognition_version<>p_recognition_version
    then return 0; end if;

  -- A source is reusable only when every independently modeled destination
  -- slot reached a successful save. Secondary soft alternatives are competing
  -- hypotheses, not additional source locations.
  if not exists(select 1 from public.share_job_place_results r
      where r.share_job_id=p_job_id and r.result_role='primary') or exists(
    select 1 from public.share_job_place_results r
     where r.share_job_id=p_job_id and r.result_role='primary'
       and (r.outcome not in ('auto_saved','already_saved') or r.place_id is null)
  ) then return 0; end if;

  for v_result in
    select r.* from public.share_job_place_results r
      where r.share_job_id=p_job_id and r.result_role='primary'
        and r.outcome in ('auto_saved','already_saved') and r.place_id is not null
        and r.confidence_score>=0.80
        and not (r.reason_codes ?| array[
          'automatic_deep_top1_plausible','media_top1_plausible','model_prior_unverified',
          'category_only_candidate','candidate_semantic_mismatch','location_conflict',
          'canonical_place_ambiguity','provider_identity_invalid'
        ]::text[])
  loop
    insert into public.recognition_cache_answers_v2(
      identity_key,slot_key,place_id,state,answer_revision,feedback_revision,evidence_revision,
      policy_version,recognition_version,source_fingerprint,specificity,terminal_status,
      semantic_check_passed,geographic_check_passed,evidence_sufficient,strong_contradiction,
      candidate_snapshot,evidence_summary,admitted_from_job_id,validated_feedback_revision,last_validated_at
    ) values(
      p_identity_key,left(v_result.logical_result_id,160),public.resolve_public_place_id(v_result.place_id),
      'ELIGIBLE',1,v_state.feedback_revision,v_state.evidence_revision,p_policy_version,p_recognition_version,
      v_fingerprint,'exact','success',true,true,true,false,v_result.candidate_snapshot,
      jsonb_build_object('confidenceScore',v_result.confidence_score,'reasonCodes',v_result.reason_codes),
      p_job_id,v_state.feedback_revision,now()
    ) on conflict(identity_key,slot_key) do update set
      place_id=excluded.place_id,state='ELIGIBLE',answer_revision=public.recognition_cache_answers_v2.answer_revision+1,
      feedback_revision=excluded.feedback_revision,evidence_revision=excluded.evidence_revision,
      policy_version=excluded.policy_version,recognition_version=excluded.recognition_version,
      source_fingerprint=excluded.source_fingerprint,specificity=excluded.specificity,
      terminal_status='success',semantic_check_passed=true,geographic_check_passed=true,
      evidence_sufficient=true,strong_contradiction=false,candidate_snapshot=excluded.candidate_snapshot,
      evidence_summary=excluded.evidence_summary,admitted_from_job_id=excluded.admitted_from_job_id,
      validated_feedback_revision=excluded.validated_feedback_revision,last_validated_at=now(),updated_at=now();
    v_count:=v_count+1;
  end loop;
  if v_count>0 then update public.recognition_source_states set state='ELIGIBLE',
    source_fingerprint=v_fingerprint,updated_at=now() where identity_key=p_identity_key; end if;
  return v_count;
end;
$$;

create or replace function public.read_recognition_answers_v2(
  p_identity_key text,p_identity_version integer,p_policy_version text,
  p_recognition_version text,p_user_id uuid
)
returns table(
  answer_id uuid,slot_key text,place_id uuid,answer_revision bigint,
  feedback_revision bigint,evidence_revision bigint,source_fingerprint text,
  candidate_snapshot jsonb,source_ai_note text
)
language sql security definer set search_path = public, pg_temp stable as $$
  select a.id,a.slot_key,public.resolve_public_place_id(a.place_id),a.answer_revision,
    a.feedback_revision,a.evidence_revision,a.source_fingerprint,a.candidate_snapshot,ss.source_ai_note
  from public.recognition_source_states ss
  join public.recognition_cache_answers_v2 a on a.identity_key=ss.identity_key
  where ss.identity_key=p_identity_key and ss.identity_version=p_identity_version
    and ss.policy_version=p_policy_version and ss.recognition_version=p_recognition_version
    and ss.state='ELIGIBLE' and not ss.whole_source_quarantined and a.state='ELIGIBLE'
    and a.feedback_revision=ss.feedback_revision and a.evidence_revision=ss.evidence_revision
    and a.policy_version=ss.policy_version and a.recognition_version=ss.recognition_version
    and not a.strong_contradiction and a.terminal_status='success'
    and (ss.visibility_scope='public' or ss.owner_user_id=p_user_id)
    and not exists (
      select 1 from public.recognition_identity_support s
       where s.user_id=p_user_id and s.identity_key=ss.identity_key
         and s.slot_key in (a.slot_key,'*')
         and public.resolve_public_place_id(s.place_id)<>public.resolve_public_place_id(a.place_id)
    )
  order by a.slot_key;
$$;

create or replace function public.commit_recognition_cache_save_v2(
  p_user_id uuid,p_identity_key text,p_answer_ids uuid[],p_expected_feedback_revision bigint,
  p_policy_version text,p_recognition_version text
)
returns table(answer_id uuid,slot_key text,saved_place_id uuid,place_id uuid,reused boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_auth uuid:=auth.uid(); v_source public.recognition_source_states%rowtype;
declare v_answer record; v_saved_id uuid; v_reused boolean; v_requested integer;
begin
  if p_user_id is null or (v_auth is not null and v_auth is distinct from p_user_id) then raise exception 'not_owner'; end if;
  v_requested:=coalesce(array_length(p_answer_ids,1),0);
  if v_requested<1 or v_requested>10 then raise exception 'invalid_answer_set'; end if;
  select * into v_source from public.recognition_source_states where identity_key=p_identity_key for update;
  if v_source.identity_key is null or v_source.state<>'ELIGIBLE' or v_source.whole_source_quarantined or
     v_source.feedback_revision<>p_expected_feedback_revision or v_source.policy_version<>p_policy_version or
     v_source.recognition_version<>p_recognition_version then raise exception 'recognition_cache_stale'; end if;
  if (select count(*) from public.recognition_cache_answers_v2 a where a.id=any(p_answer_ids)
      and a.identity_key=p_identity_key and a.state='ELIGIBLE' and a.feedback_revision=v_source.feedback_revision
      and a.evidence_revision=v_source.evidence_revision and a.policy_version=p_policy_version
      and a.recognition_version=p_recognition_version and a.terminal_status='success'
      and a.semantic_check_passed and a.geographic_check_passed and a.evidence_sufficient
      and not a.strong_contradiction)<>v_requested then raise exception 'recognition_cache_stale'; end if;

  for v_answer in select a.* from public.recognition_cache_answers_v2 a
    where a.id=any(p_answer_ids) order by a.slot_key for update
  loop
    if exists(select 1 from public.recognition_identity_support s where s.user_id=p_user_id
      and s.identity_key=p_identity_key and s.slot_key in (v_answer.slot_key,'*')
      and public.resolve_public_place_id(s.place_id)<>public.resolve_public_place_id(v_answer.place_id))
      then raise exception 'user_identity_conflict'; end if;
    select sp.id into v_saved_id from public.saved_places sp where sp.user_id=p_user_id
      and public.resolve_public_place_id(sp.place_id)=public.resolve_public_place_id(v_answer.place_id)
      order by sp.created_at limit 1 for update;
    v_reused:=v_saved_id is not null;
    if v_saved_id is null then
      insert into public.saved_places(user_id,place_id,source_type,source_url,ai_note,category,category_source,
        category_confidence,category_model_version,category_user_overridden,categorized_at)
      select p_user_id,public.resolve_public_place_id(v_answer.place_id),
        case when v_source.platform in ('tiktok','instagram','youtube','facebook','snapchat') then v_source.platform else 'link' end,
        v_source.canonical_url,v_source.source_ai_note,p.category,'google_type',1,'recognition-cache-v2.1',false,now()
      from public.places p where p.id=public.resolve_public_place_id(v_answer.place_id)
      returning id into v_saved_id;
    end if;
    perform public.attach_saved_place_source(p_user_id,v_saved_id,v_source.identity_key,v_source.identity_version,
      case when v_source.platform in ('tiktok','instagram','youtube','facebook','snapchat') then v_source.platform else 'link' end,
      v_source.content_id,v_source.canonical_url,v_source.canonical_url,null,null,null,v_source.source_ai_note,null);
    answer_id:=v_answer.id; slot_key:=v_answer.slot_key; saved_place_id:=v_saved_id;
    place_id:=public.resolve_public_place_id(v_answer.place_id); reused:=v_reused; return next;
  end loop;
end;
$$;

create or replace function public.complete_recognition_revalidation_v2(
  p_revalidation_task_id uuid,p_decision text,p_supported_place_id uuid,
  p_diagnostics jsonb default '{}'::jsonb,p_error_code text default null
)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_task public.recognition_revalidation_tasks%rowtype; v_source public.recognition_source_states%rowtype;
declare v_answer record; v_leader uuid; v_leader_count integer:=0; v_runner_count integer:=0; v_total integer:=0;
declare v_can_resolve boolean:=false; v_delay integer;
begin
  if p_decision not in ('AGREES_WITH_REPLACEMENT','SUPPORTS_PREVIOUS','SUPPORTS_OTHER','INSUFFICIENT_EVIDENCE','TECHNICAL_FAILURE')
    then raise exception 'invalid_revalidation_decision'; end if;
  select * into v_task from public.recognition_revalidation_tasks where id=p_revalidation_task_id for update;
  if v_task.id is null then raise exception 'revalidation_task_not_found'; end if;
  if v_task.state in ('COMPLETED','FAILED','STALE') then return lower(v_task.state); end if;
  select * into v_source from public.recognition_source_states where identity_key=v_task.identity_key for update;
  if v_source.feedback_revision<>v_task.feedback_revision or v_source.evidence_revision<>v_task.evidence_revision
    or v_source.policy_version<>v_task.policy_version then
    update public.recognition_revalidation_tasks set state='STALE',decision=p_decision,
      diagnostics=coalesce(p_diagnostics,'{}'),completed_at=now(),updated_at=now() where id=v_task.id;
    return 'stale';
  end if;
  update public.recognition_revalidation_tasks set attempts=least(attempts+1,max_attempts),decision=p_decision,
    supported_place_id=p_supported_place_id,diagnostics=coalesce(p_diagnostics,'{}'),last_error_code=p_error_code,updated_at=now()
    where id=v_task.id returning * into v_task;

  if p_decision='TECHNICAL_FAILURE' then
    if v_task.attempts<v_task.max_attempts then
      v_delay:=least(900,30*(2^(v_task.attempts-1))::integer);
      update public.recognition_revalidation_tasks set state='RETRY_WAIT',next_attempt_at=now()+make_interval(secs=>v_delay),updated_at=now() where id=v_task.id;
      update public.share_media_tasks set status='failed',failure_code=coalesce(p_error_code,'technical_failure'),
        progress_stage='cleanup',completed_at=now() where recognition_revalidation_task_id=v_task.id and status='processing';
      update public.recognition_source_states set state='QUARANTINED',updated_at=now() where identity_key=v_task.identity_key;
      return 'retry_wait';
    end if;
    update public.recognition_revalidation_tasks set state='FAILED',completed_at=now(),updated_at=now() where id=v_task.id;
    update public.recognition_source_states set state='QUARANTINED',updated_at=now() where identity_key=v_task.identity_key;
    return 'failed';
  end if;

  if p_decision='AGREES_WITH_REPLACEMENT' and v_task.replacement_place_id is not null and
     public.resolve_public_place_id(p_supported_place_id)=public.resolve_public_place_id(v_task.replacement_place_id) and
     coalesce(p_diagnostics->>'strongContradiction','false')<>'true' then
    select public.resolve_public_place_id(s.place_id),count(*)::integer into v_leader,v_leader_count
      from public.recognition_identity_support s
     where s.identity_key=v_task.identity_key and s.slot_key=v_task.slot_key
     group by public.resolve_public_place_id(s.place_id)
     order by count(*) desc,public.resolve_public_place_id(s.place_id) limit 1;
    select count(*)::integer into v_total from public.recognition_identity_support s
      where s.identity_key=v_task.identity_key and s.slot_key=v_task.slot_key;
    select coalesce(max(c),0)::integer into v_runner_count from (
      select count(*) c from public.recognition_identity_support s where s.identity_key=v_task.identity_key
       and s.slot_key=v_task.slot_key and public.resolve_public_place_id(s.place_id)<>public.resolve_public_place_id(v_leader)
       group by public.resolve_public_place_id(s.place_id)) q;
    -- One non-conflicting correction plus model agreement resolves. Once two
    -- identities have support, apply the meaningful-lead defaults.
    v_can_resolve:=public.resolve_public_place_id(v_leader)=public.resolve_public_place_id(v_task.replacement_place_id)
      and ((v_runner_count=0 and v_leader_count>=1) or
        (v_leader_count>=3 and v_leader_count-v_runner_count>=2 and v_leader_count*3>=v_total*2));
  end if;

  if v_can_resolve then
    if v_task.slot_key='*' then
      -- Ambiguous scope cannot invent a destination slot. It becomes eligible
      -- only when exactly one prior answer was affected.
      select a.* into v_answer from public.recognition_cache_answers_v2 a
       where a.identity_key=v_task.identity_key and
        public.resolve_public_place_id(a.place_id)=public.resolve_public_place_id(v_task.previous_place_id)
       order by a.slot_key limit 1 for update;
      if v_answer.id is null then v_can_resolve:=false; end if;
    else
      select a.* into v_answer from public.recognition_cache_answers_v2 a
       where a.identity_key=v_task.identity_key and a.slot_key=v_task.slot_key for update;
      if v_answer.id is null then v_can_resolve:=false; end if;
    end if;
  end if;

  if v_can_resolve then
    update public.recognition_cache_answers_v2 set
      place_id=public.resolve_public_place_id(v_task.replacement_place_id),state='ELIGIBLE',
      answer_revision=answer_revision+1,feedback_revision=v_source.feedback_revision,
      validated_feedback_revision=v_source.feedback_revision,semantic_check_passed=true,
      geographic_check_passed=true,evidence_sufficient=true,strong_contradiction=false,
      last_validated_at=now(),updated_at=now() where id=v_answer.id;
    update public.recognition_source_states set
      state='ELIGIBLE',whole_source_quarantined=false,last_invalidation_reason=null,updated_at=now()
      where identity_key=v_task.identity_key;
  else
    update public.recognition_cache_answers_v2 set state='DISPUTED',updated_at=now()
      where identity_key=v_task.identity_key and (v_task.slot_key='*' or slot_key=v_task.slot_key);
    update public.recognition_source_states set state='DISPUTED',updated_at=now()
      where identity_key=v_task.identity_key;
  end if;
  update public.recognition_revalidation_tasks set state='COMPLETED',completed_at=now(),updated_at=now() where id=v_task.id;
  update public.share_media_tasks set status='completed',progress_stage='cleanup',completed_at=now()
    where recognition_revalidation_task_id=v_task.id and status='processing';
  return case when v_can_resolve then 'eligible' else 'disputed' end;
end;
$$;

create or replace function public.admit_recognition_after_media_completion_v2()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.share_jobs%rowtype; v_count integer;
begin
  if new.task_kind='recognition' and new.status='completed' and old.status is distinct from new.status
     and new.share_job_id is not null then
    select * into v_job from public.share_jobs where id=new.share_job_id;
    if v_job.status='completed' and v_job.recognition_identity_key is not null then
      v_count:=public.admit_recognition_answers_v2(v_job.id,v_job.recognition_identity_key,
        coalesce(v_job.source_platform,new.platform,'unknown'),coalesce(v_job.recognition_content_id,v_job.recognition_identity_key),
        coalesce(v_job.canonical_url,new.canonical_url,new.source_url),coalesce(v_job.recognition_identity_version,1),
        'recognition-cache-v2.1','vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups');
      if v_count>0 then
        insert into public.recognition_cache_events(event_name,identity_key,platform,detail)
        values('recognition_cache_v2_admitted',v_job.recognition_identity_key,coalesce(v_job.source_platform,new.platform),
          jsonb_build_object('answerCount',v_count));
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists share_media_tasks_admit_recognition_v2 on public.share_media_tasks;
create trigger share_media_tasks_admit_recognition_v2 after update of status on public.share_media_tasks
  for each row execute function public.admit_recognition_after_media_completion_v2();

-- Keep source-grounded generated notes available to future cache recipients;
-- user-authored saved_places.notes never enters this table.
create or replace function public.capture_recognition_source_ai_note_v2()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.ai_note is not null and (tg_op='INSERT' or old.ai_note is null or old.ai_note is distinct from new.ai_note) then
    update public.recognition_source_states set source_ai_note=left(new.ai_note,1000),updated_at=now()
      where identity_key=new.identity_key and visibility_scope='public';
  end if;
  return new;
end;
$$;
drop trigger if exists saved_place_sources_capture_v2_note on public.saved_place_sources;
create trigger saved_place_sources_capture_v2_note after insert or update on public.saved_place_sources
  for each row execute function public.capture_recognition_source_ai_note_v2();

-- State follows the durable worker claim, but no model/network call holds a DB lock.
create or replace function public.mark_recognition_revalidation_processing_v2()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.task_kind='recognition_revalidation' and new.status='processing' and old.status is distinct from new.status then
    update public.recognition_revalidation_tasks set state='PROCESSING',updated_at=now()
      where id=new.recognition_revalidation_task_id and state in ('QUEUED','RETRY_WAIT');
    update public.recognition_source_states ss set state='REVALIDATING',updated_at=now()
      from public.recognition_revalidation_tasks rt where rt.id=new.recognition_revalidation_task_id
       and ss.identity_key=rt.identity_key and ss.feedback_revision=rt.feedback_revision;
    update public.recognition_cache_answers_v2 a set state='REVALIDATING',updated_at=now()
      from public.recognition_revalidation_tasks rt where rt.id=new.recognition_revalidation_task_id
       and a.identity_key=rt.identity_key and (rt.slot_key='*' or a.slot_key=rt.slot_key)
       and a.feedback_revision=rt.feedback_revision;
  end if;
  return new;
end;
$$;
drop trigger if exists share_media_tasks_revalidation_processing on public.share_media_tasks;
create trigger share_media_tasks_revalidation_processing after update of status on public.share_media_tasks
  for each row execute function public.mark_recognition_revalidation_processing_v2();

-- Legacy machine upserts remain useful audit material, but can no longer clear
-- a correction invalidation. Only the explicit V2 revalidation state machine
-- may make a future answer reusable.
create or replace function public.recognition_cache_preserve_trust()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.invalidation_reason='user_correction' and old.invalidated_at is not null then
    new.invalidated_at:=old.invalidated_at;
    new.invalidation_reason:=old.invalidation_reason;
  end if;
  if old.trust_level='USER_CONFIRMED' and old.invalidated_at is null and new.trust_level<>'USER_CONFIRMED' then
    new.trust_level:=old.trust_level;
    new.result_type:=old.result_type;
    new.canonical_place_id:=old.canonical_place_id;
    new.candidate_payload:=coalesce(old.candidate_payload,new.candidate_payload);
    new.confirmed_at:=old.confirmed_at;
    new.confirmation_count:=old.confirmation_count;
  end if;
  return new;
end;
$$;

-- Account deletion removes attributable support through the FK. Conservatively
-- dispute that scope so a former consensus is never silently retained.
create or replace function public.recompute_recognition_after_support_delete_v2()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('nearr.suppress_support_delete_recompute',true)='on' then return old; end if;
  update public.recognition_source_states set feedback_revision=feedback_revision+1,
    state='DISPUTED',last_invalidation_reason='support_removed',updated_at=now()
    where identity_key=old.identity_key;
  update public.recognition_cache_answers_v2 a set state='DISPUTED',
    feedback_revision=ss.feedback_revision,answer_revision=a.answer_revision+1,updated_at=now()
    from public.recognition_source_states ss where ss.identity_key=old.identity_key
      and a.identity_key=old.identity_key and (old.slot_key='*' or a.slot_key=old.slot_key);
  return old;
end;
$$;
drop trigger if exists recognition_support_delete_recompute on public.recognition_identity_support;
create trigger recognition_support_delete_recompute after delete on public.recognition_identity_support
  for each row execute function public.recompute_recognition_after_support_delete_v2();

-- Explicit job resolution is one current user assertion, never an autosave
-- count. It updates current support but does not admit a legacy/candidate row.
create or replace function public.resolve_share_job(p_job_id uuid,p_saved_place_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid:=auth.uid(); v_saved_owner uuid; v_place_id uuid; v_updated integer;
  v_decision text; v_identity_key text; v_slot_key text; v_source_platform text;
  v_content_id text; v_canonical_url text; v_identity_version integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_saved_place_id is null then raise exception 'invalid_saved_place_id'; end if;
  select sp.user_id,public.resolve_public_place_id(sp.place_id) into v_saved_owner,v_place_id
    from public.saved_places sp where sp.id=p_saved_place_id;
  if v_saved_owner is distinct from v_uid then raise exception 'saved_place_not_owned'; end if;
  update public.share_jobs set status='completed',saved_place_id=p_saved_place_id,completed_at=now(),
    progress_stage='completed',updated_at=now()
    where id=p_job_id and user_id=v_uid and status in ('needs_help','failed')
    returning decision,recognition_identity_key,recognition_identity_version,
      recognition_content_id,canonical_url,source_platform
      into v_decision,v_identity_key,v_identity_version,v_content_id,v_canonical_url,v_source_platform;
  get diagnostics v_updated=row_count;
  if v_updated=0 then return false; end if;
  if v_decision is distinct from 'multi_candidate_confirmation' and v_identity_key is not null then
    update public.recognition_cache rc set result_type='verified_place',trust_level='USER_CONFIRMED',
      canonical_place_id=v_place_id,confirmation_count=rc.confirmation_count+1,confirmed_at=now(),
      last_verified_at=now(),last_seen_at=now() where rc.identity_key=v_identity_key and rc.invalidated_at is null;
    insert into public.recognition_source_states(identity_key,platform,content_id,canonical_url,identity_version,
      policy_version,recognition_version,state)
    values(v_identity_key,case when v_source_platform in ('tiktok','instagram','youtube','facebook','snapchat')
      then v_source_platform else 'other' end,coalesce(v_content_id,v_identity_key),coalesce(v_canonical_url,''),
      coalesce(v_identity_version,1),'recognition-cache-v2.1',
      'vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups','UNVERIFIED')
    on conflict(identity_key) do nothing;
    select a.slot_key into v_slot_key from public.recognition_cache_answers_v2 a
      where a.identity_key=v_identity_key and public.resolve_public_place_id(a.place_id)=v_place_id
      order by a.slot_key limit 1;
    v_slot_key:=coalesce(v_slot_key,'*');
    insert into public.recognition_identity_support(user_id,identity_key,slot_key,place_id,assertion_kind,asserted_at)
    values(v_uid,v_identity_key,v_slot_key,v_place_id,'CONFIRMATION',now())
    on conflict(user_id,identity_key,slot_key) do update set place_id=excluded.place_id,
      assertion_kind='CONFIRMATION',source_event_id=null,asserted_at=now(),updated_at=now();
  end if;
  return true;
end;
$$;

-- V2 telemetry extends the bounded vocabulary without exposing candidate text.
alter table public.recognition_cache_events drop constraint if exists recognition_cache_events_event_name_check;
alter table public.recognition_cache_events add constraint recognition_cache_events_event_name_check check (event_name in (
  'recognition_cache_hit','recognition_cache_miss','recognition_cache_candidate_hit',
  'recognition_cache_candidate_auto_save','recognition_cache_invalidated','recognition_singleflight_joined',
  'source_attached_existing_place','source_deduped','candidate_semantic_mismatch',
  'candidate_semantic_override','autosave_blocked_semantic_mismatch','user_rejected_recognition',
  'cache_hit_disputed_result','disputed_candidate_suppressed','recognition_recomputed_after_rejection',
  'recognition_cache_v2_hit','recognition_cache_v2_bypass','recognition_cache_v2_admitted',
  'recognition_cache_v2_stale_commit_prevented','recognition_revalidation_completed'
));

alter table public.recognition_source_states enable row level security;
alter table public.recognition_cache_answers_v2 enable row level security;
alter table public.recognition_correction_events enable row level security;
alter table public.recognition_identity_support enable row level security;
alter table public.recognition_revalidation_tasks enable row level security;

revoke all on public.recognition_source_states,public.recognition_cache_answers_v2,
  public.recognition_correction_events,public.recognition_identity_support,
  public.recognition_revalidation_tasks from public,anon,authenticated;
grant all on public.recognition_source_states,public.recognition_cache_answers_v2,
  public.recognition_correction_events,public.recognition_identity_support,
  public.recognition_revalidation_tasks to service_role;

revoke all on function public.queue_recognition_revalidation_media_task(uuid),
  public.queue_ready_recognition_revalidations(integer),
  public.recover_abandoned_recognition_revalidations_v2(integer),
  public.apply_recognition_feedback_v2(uuid,uuid,uuid,text,text),
  public.admit_recognition_answers_v2(uuid,text,text,text,text,integer,text,text),
  public.read_recognition_answers_v2(text,integer,text,text,uuid),
  public.commit_recognition_cache_save_v2(uuid,text,uuid[],bigint,text,text),
  public.complete_recognition_revalidation_v2(uuid,text,uuid,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.queue_ready_recognition_revalidations(integer),
  public.recover_abandoned_recognition_revalidations_v2(integer),
  public.admit_recognition_answers_v2(uuid,text,text,text,text,integer,text,text),
  public.read_recognition_answers_v2(text,integer,text,text,uuid),
  public.commit_recognition_cache_save_v2(uuid,text,uuid[],bigint,text,text),
  public.complete_recognition_revalidation_v2(uuid,text,uuid,jsonb,text)
  to service_role;
revoke all on function public.correct_saved_place_provider_v2(uuid,uuid,text,text,text,numeric,text,text),
  public.reject_saved_place_recognition_v2(uuid,text,text) from public,anon;
grant execute on function public.correct_saved_place_provider_v2(uuid,uuid,text,text,text,numeric,text,text),
  public.reject_saved_place_recognition_v2(uuid,text,text) to authenticated;
revoke all on function public.reject_saved_place_recognition(uuid,text) from public,anon;
grant execute on function public.reject_saved_place_recognition(uuid,text) to authenticated;
