-- Qualify the compatibility pointer for the same reason as the saved-place
-- lookup: `saved_place_id` is also an output variable of the table function.
do $patch$
declare
  v_definition text;
  v_original constant text := 'update public.share_jobs set candidate_payload=v_payload,saved_place_id=coalesce(saved_place_id,v_saved),';
  v_replacement constant text := 'update public.share_jobs as sj set candidate_payload=v_payload,saved_place_id=coalesce(sj.saved_place_id,v_saved),';
begin
  select pg_get_functiondef(
    'public.auto_complete_named_lead(uuid,text,uuid,text,text,text,numeric,numeric,text,jsonb,numeric,text)'::regprocedure
  ) into v_definition;
  if position(v_original in v_definition)=0 then
    raise exception 'auto_complete_named_lead job update shape changed';
  end if;
  execute replace(v_definition,v_original,v_replacement);
end;
$patch$;
