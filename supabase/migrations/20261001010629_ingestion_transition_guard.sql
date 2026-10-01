-- Ingestion may invalidate dependent editorial work, but never skip verification.
create or replace function public.commit_discovery(p_story jsonb,p_expected_version integer,p_record jsonb,p_owner uuid) returns void language plpgsql security invoker set search_path=public as $$
declare previous_status text; begin
 perform 1 from public.ingestion_leases where id='discovery' and owner=p_owner and expires_at>now() for update;
 if not found then raise exception 'Ingestion lease lost; refusing stale worker write'; end if;
 select status into previous_status from public.stories where id=(p_story->>'id')::uuid;
 if coalesce((p_story->>'is_demo')::boolean,true) then raise exception 'Ingestion cannot write demo records'; end if;
 if previous_status is null and p_story->>'status'<>'detected' then raise exception 'Ingestion must create detected stories'; end if;
 if previous_status is not null and p_story->>'status' <> previous_status and not (p_story->>'status'='researched' and previous_status in ('drafted','assets_cleared','recording_needed','render_ready','review','approved','scheduled')) then raise exception 'Ingestion cannot advance editorial status'; end if;
 perform public.save_story(p_story,p_expected_version);
 insert into public.discovery_records select * from jsonb_populate_record(null::public.discovery_records,p_record);
end $$;
