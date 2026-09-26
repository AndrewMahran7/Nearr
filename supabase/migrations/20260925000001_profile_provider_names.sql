-- Development rollout: additive, nullable provider-name storage.
-- No backfill: existing profiles remain untouched until a provider supplies
-- structured given/family fields on a successful authentication.

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (
    new.id,
    new.email,
    nullif(btrim(new.raw_user_meta_data ->> 'given_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'family_name'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
