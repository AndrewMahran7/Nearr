-- A source-only guard leaves a second gap: a stale anonymous client could
-- create a new save after account conversion, invisible to the destination.
-- Serialize anonymous save creation on its onboarding session before insert.
-- A save committed first is part of V2's subsequent save scan; a save attempted
-- after conversion is rejected instead of silently staying on the old account.

create or replace function public.saved_places_reject_converted_anonymous_insert()
returns trigger language plpgsql security definer
set search_path = public, auth, pg_temp as $$
begin
  if exists (select 1 from auth.users u
      where u.id = new.user_id and u.is_anonymous is true) then
    perform s.id from public.onboarding_v2_sessions s
      where s.anonymous_user_id = new.user_id
      order by s.id for update;
    if exists (select 1 from public.onboarding_v2_sessions s
        where s.anonymous_user_id = new.user_id
          and s.lifecycle = 'permanent_account'
          and s.permanent_user_id is not null
          and s.permanent_user_id <> s.anonymous_user_id) then
      raise exception 'converted_anonymous_save_read_only';
    end if;
  end if;
  return new;
end;
$$;

create trigger saved_places_converted_anonymous_insert_guard
  before insert on public.saved_places
  for each row execute function public.saved_places_reject_converted_anonymous_insert();
