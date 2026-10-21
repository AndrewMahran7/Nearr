-- Functional interface preference, separate from consent and billing.
create table public.account_ui_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 locale text not null check(locale in ('en-US','es-MX','es-ES','pt-BR','fr','de','it','ja','ko','zh-Hans')),
 updated_at timestamptz not null default now()
);
alter table public.account_ui_preferences enable row level security;
revoke all on public.account_ui_preferences from public,anon,authenticated;
grant select on public.account_ui_preferences to authenticated;
grant all on public.account_ui_preferences to service_role;
create policy account_ui_preferences_owner on public.account_ui_preferences for select to authenticated using(auth.uid()=user_id);
create or replace function public.set_my_ui_locale(p_locale text)
returns void language plpgsql security definer set search_path=public,auth,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'locale_auth_required'; end if;
 if p_locale is null or p_locale not in ('en-US','es-MX','es-ES','pt-BR','fr','de','it','ja','ko','zh-Hans') then raise exception 'locale_not_supported'; end if;
 insert into public.account_ui_preferences(user_id,locale) values(auth.uid(),p_locale)
  on conflict(user_id) do update set locale=excluded.locale,updated_at=now();
end; $$;
revoke all on function public.set_my_ui_locale(text) from public,anon;
grant execute on function public.set_my_ui_locale(text) to authenticated;
