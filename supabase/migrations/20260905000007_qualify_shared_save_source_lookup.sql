-- Forward correction for Nearr-Dev, where 000005 was already applied before
-- its live transactional proof found PL/pgSQL output-column shadowing. Fresh
-- databases already receive the qualified definition from 000005.
do $migration$
declare
  v_definition text;
  v_ambiguous constant text :=
    'select 1 from public.saved_place_sources where saved_place_id = v_saved_id';
  v_qualified constant text :=
    'select 1 from public.saved_place_sources source_row where source_row.saved_place_id = v_saved_id';
begin
  select pg_get_functiondef('public.save_shared_place(uuid,text)'::regprocedure)
    into v_definition;
  if strpos(v_definition, v_ambiguous) > 0 then
    execute replace(v_definition, v_ambiguous, v_qualified);
  end if;
end;
$migration$;
