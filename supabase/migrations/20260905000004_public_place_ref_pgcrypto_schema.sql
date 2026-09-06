-- `gen_random_bytes` is installed in Supabase's `extensions` schema. Keep the
-- security-definer search path narrow and qualify the extension explicitly.
create or replace function public.new_public_place_ref()
returns text
language sql
volatile
set search_path = public, pg_temp
as $$
  select 'r_' || translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_');
$$;

revoke all on function public.new_public_place_ref()
  from public, anon, authenticated;
