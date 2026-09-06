-- Forward correction for Nearr-Dev. The named constraint avoids PL/pgSQL
-- output-column shadowing while keeping the same (saved_place_id, identity_key)
-- idempotency boundary. Fresh databases already receive this from 000005.
do $migration$
declare
  v_definition text;
  v_ambiguous constant text :=
    'on conflict (saved_place_id, identity_key) do nothing';
  v_qualified constant text :=
    'on conflict on constraint saved_place_sources_saved_place_id_identity_key_key do nothing';
begin
  select pg_get_functiondef('public.save_shared_place(uuid,text)'::regprocedure)
    into v_definition;
  if strpos(v_definition, v_ambiguous) > 0 then
    execute replace(v_definition, v_ambiguous, v_qualified);
  end if;
end;
$migration$;
