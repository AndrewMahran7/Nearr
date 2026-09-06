-- Complete the PL/pgSQL shadowing repair for the correction wrapper's two
-- source reads. `saved_place_id` is also a RETURNS TABLE output variable, so
-- every column occurrence must be explicitly table-qualified.
do $migration$
declare
  v_definition text;
  v_ambiguous constant text :=
    'where saved_place_id = v_result.saved_place_id';
  v_qualified constant text :=
    'where public.saved_place_sources.saved_place_id = v_result.saved_place_id';
begin
  select pg_get_functiondef(
    'public.correct_saved_place_provider(uuid,uuid,text,text,text,numeric,text)'::regprocedure
  ) into v_definition;
  if strpos(v_definition, v_ambiguous) > 0 then
    execute replace(v_definition, v_ambiguous, v_qualified);
  end if;
end;
$migration$;
