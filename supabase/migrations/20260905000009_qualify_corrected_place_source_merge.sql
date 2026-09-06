-- The multi-source correction wrapper predates the shared-place fix but its
-- output column `saved_place_id` shadows the identically named conflict target
-- under PL/pgSQL validation. Canonical-place convergence is part of the shared
-- discovery contract, so use the same explicit unique constraint as the new
-- save RPC.
do $migration$
declare
  v_definition text;
  v_ambiguous constant text :=
    'on conflict (saved_place_id, identity_key) do update set';
  v_qualified constant text :=
    'on conflict on constraint saved_place_sources_saved_place_id_identity_key_key do update set';
begin
  select pg_get_functiondef(
    'public.correct_saved_place_provider(uuid,uuid,text,text,text,numeric,text)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_ambiguous) > 0 then
    execute replace(v_definition, v_ambiguous, v_qualified);
  end if;
end;
$migration$;
