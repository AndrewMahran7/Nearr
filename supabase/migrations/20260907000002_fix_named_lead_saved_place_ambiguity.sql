-- PL/pgSQL output columns are variables. Qualify the saved_places lookup so
-- the table-return `place_id` name cannot shadow the physical column.
do $patch$
declare
  v_definition text;
  v_original constant text := 'select id into v_saved from public.saved_places where user_id=v_uid and place_id=v_place for update;';
  v_replacement constant text := 'select sp.id into v_saved from public.saved_places sp where sp.user_id=v_uid and sp.place_id=v_place for update;';
begin
  select pg_get_functiondef(
    'public.auto_complete_named_lead(uuid,text,uuid,text,text,text,numeric,numeric,text,jsonb,numeric,text)'::regprocedure
  ) into v_definition;
  if position(v_original in v_definition)=0 then
    raise exception 'auto_complete_named_lead lookup shape changed';
  end if;
  execute replace(v_definition,v_original,v_replacement);
end;
$patch$;
