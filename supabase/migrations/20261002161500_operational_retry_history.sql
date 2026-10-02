alter table public.control_jobs add column error_history jsonb not null default '[]';
create or replace function public.finish_control_job(p_id uuid,p_token uuid,p_status text,p_result jsonb,p_error text,p_retryable boolean) returns void language plpgsql security invoker set search_path=public as $$
begin
 if p_status not in ('succeeded','blocked','failed','dead_letter') then raise exception 'Invalid job outcome'; end if;
 update control_jobs set status=p_status,result=p_result,error=left(p_error,1500),error_history=case when p_error is not null then error_history||jsonb_build_array(jsonb_build_object('at',now(),'code',left(p_error,500),'attempt',attempts)) else error_history end,retryable=p_retryable,lease_token=null,leased_until=null,updated_at=now() where id=p_id and lease_token=p_token and status='running' and leased_until>now();
 if not found then raise exception 'Job lease lost'; end if;
end $$;
create function public.reschedule_control_retry(p_id uuid,p_delay integer,p_demo boolean) returns void language plpgsql security invoker set search_path=public as $$
begin
 update control_jobs set status=case when attempts>=3 then 'dead_letter' else 'queued' end,due_at=now()+make_interval(secs=>greatest(60,least(p_delay,86400))),updated_at=now() where id=p_id and is_demo=p_demo and status='failed' and retryable;
end $$;
create function public.resolve_control_job(p_id uuid,p_demo boolean,p_actor text) returns void language plpgsql security invoker set search_path=public as $$
begin
 update control_jobs set status='cancelled',error_history=error_history||jsonb_build_array(jsonb_build_object('at',now(),'resolved_by',p_actor)),updated_at=now() where id=p_id and is_demo=p_demo and status in ('blocked','failed','dead_letter');
 if not found then raise exception 'Job cannot be resolved in this state'; end if;
end $$;
-- Queries actually used by the public form's per-request throttle.
create index opportunity_rate_window on public.opportunity_intake(request_hash,created_at desc);
alter table public.opportunity_intake add column context jsonb not null default '{}';
create or replace function public.submit_opportunity(p_data jsonb,p_hash text) returns void language plpgsql security invoker set search_path=public as $$
begin
 perform pg_advisory_xact_lock(737374);
 if length(p_hash)<>64 or (select count(*) from opportunity_intake where created_at>now()-interval '1 minute')>=20 or (select count(*) from opportunity_intake where request_hash=p_hash and created_at>now()-interval '1 hour')>=5 then raise exception 'Please retry later'; end if;
 insert into opportunity_intake(kind,name,email,company,role,details,source,consent_at,privacy_version,request_hash,context)
 values(p_data->>'kind',p_data->>'name',lower(p_data->>'email'),coalesce(p_data->>'company',''),coalesce(p_data->>'role',''),p_data->>'details','public-site',now(),'2026-10-02/v2-draft',p_hash,coalesce(p_data->'context','{}'));
end $$;
do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('reschedule_control_retry','resolve_control_job') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
