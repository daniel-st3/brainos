-- Reuse the existing queue. This claimant cannot consume C2/manual creative jobs.
create function public.claim_newsroom_job() returns jsonb language plpgsql security invoker set search_path=public as $$
declare j control_jobs;
begin
 update control_jobs set status='dead_letter',error='Newsroom lease expired after three attempts',lease_token=null,leased_until=null
 where is_demo=true and kind='creative' and input->>'runner'='newsroom-exec/v1' and status='running' and leased_until<now() and attempts>=3;
 select * into j from control_jobs where is_demo=true and kind='creative' and input->>'runner'='newsroom-exec/v1' and is_demo=true
 and due_at<=now() and attempts<3 and (status='queued' or status='running' and leased_until<now())
 order by due_at for update skip locked limit 1;
 if not found then return null; end if;
 update control_jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),leased_until=now()+interval '10 minutes',updated_at=now() where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
create function public.newsroom_job(p_id uuid,p_token uuid,p_heartbeat boolean default false) returns jsonb language plpgsql security invoker set search_path=public as $$
declare j control_jobs;
begin
 select * into j from control_jobs where id=p_id and lease_token=p_token and status='running' and leased_until>now()
 and kind='creative' and input->>'runner'='newsroom-exec/v1' and is_demo=true for update;
 if not found then raise exception 'Newsroom lease lost'; end if;
 if p_heartbeat then update control_jobs set leased_until=now()+interval '10 minutes',updated_at=now() where id=j.id; end if;
 return to_jsonb(j);
end $$;
revoke all on function public.claim_newsroom_job(),public.newsroom_job(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_newsroom_job(),public.newsroom_job(uuid,uuid,boolean) to service_role;
