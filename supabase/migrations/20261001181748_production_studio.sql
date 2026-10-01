-- Production complements editorial state. No discovery or editorial transition changes.
create table public.production_packages (
 id uuid primary key, story_id uuid not null references public.stories(id), draft_id uuid not null unique,
 version integer not null default 1 check(version>0), valid boolean not null default true, invalid_reason text,
 data jsonb not null, updated_at timestamptz not null default now(),
 foreign key(draft_id,story_id) references public.drafts(id,story_id)
);
create index production_packages_story on public.production_packages(story_id);
create table public.production_history (
 package_id uuid not null references public.production_packages(id), version integer not null,
 snapshot jsonb not null, created_at timestamptz not null default now(), primary key(package_id,version)
);
create table public.production_jobs (
 id uuid primary key default gen_random_uuid(), package_id uuid not null references public.production_packages(id),
 package_version integer not null, kind text not null check(kind in ('transcribe','render')), input jsonb not null,
 status text not null default 'queued' check(status in ('queued','running','succeeded','failed','stale')),
 attempts integer not null default 0, lease_token uuid, leased_until timestamptz, error text,
 created_at timestamptz not null default now(), unique(package_id,package_version,kind)
);
create index production_jobs_pending on public.production_jobs(status,created_at);
create table public.production_batches (
 id uuid primary key, name text not null, package_ids uuid[] not null check(cardinality(package_ids) between 3 and 10),
 created_at timestamptz not null default now()
);
create function public.production_audit() returns trigger language plpgsql security invoker set search_path=public as $$
begin insert into production_history(package_id,version,snapshot) values(new.id,new.version,to_jsonb(new)); return new; end $$;
create trigger production_audit after insert or update on public.production_packages for each row execute function public.production_audit();
create trigger production_history_immutable before update or delete on public.production_history for each row execute function public.keep_operational_history();
create function public.invalidate_production() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if tg_table_name='drafts' then
 if (new.status is distinct from old.status or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
  update production_packages set valid=false,invalid_reason='Script approval changed. Create a package for the newly approved revision.',version=version+1,updated_at=now() where draft_id=new.id and valid;
 end if;
 elsif tg_table_name='stories' then
 if (new.active_draft_id is distinct from old.active_draft_id or not new.research_confirmed) then
  update production_packages set valid=false,invalid_reason='Script revision or confirmed research changed. Recording requires review.',version=version+1,updated_at=now() where story_id=new.id and valid;
 end if;
 end if;
 return new;
end $$;
create trigger production_draft_changed after update on public.drafts for each row execute function public.invalidate_production();
create trigger production_story_changed after update on public.stories for each row execute function public.invalidate_production();
create function public.save_production(p_package jsonb,p_expected integer,p_actor text,p_job uuid default null,p_token uuid default null) returns jsonb language plpgsql security invoker set search_path=public as $$
declare v production_packages; d drafts; s stories; prev production_packages; sid uuid:=(p_package->>'story_id')::uuid; begin
 -- Same lock order as editorial writes; prevents approval changing during a commit.
 perform pg_advisory_xact_lock(hashtextextended(sid::text,0));
 select * into s from stories where id=sid for update;
 select * into d from drafts where id=(p_package->>'draft_id')::uuid and story_id=sid;
 if d.id is null or s.active_draft_id is distinct from d.id or d.status<>'approved' or d.approved_at is null or not s.research_confirmed then raise exception 'Current exact approved revision required'; end if;
 if not exists(select 1 from angles where id=d.angle_id and story_id=sid and approval_state='approved') then raise exception 'Approved angle required'; end if;
 if exists(select 1 from unnest(d.asset_ids) a where not exists(select 1 from assets where id=a and story_id=sid and publishable and rights_status='cleared' and length(usage_basis)>0 and cleared_by is not null)) then raise exception 'Asset clearance required'; end if;
 v:=jsonb_populate_record(null::production_packages,p_package);
 select * into prev from production_packages where id=v.id for update;
 if prev.id is not null and (prev.version<>p_expected or not prev.valid or prev.draft_id<>v.draft_id or prev.story_id<>v.story_id) then raise exception 'Conflict: production changed or invalidated'; end if;
 if prev.id is null and p_expected<>0 then raise exception 'Production missing'; end if;
 if v.data->'packet'->>'draft_id'<>d.id::text or (v.data->'packet'->>'revision')::int<>d.revision or (v.data->'packet'->>'approved_at')::timestamptz<>d.approved_at or v.data->>'angle_id'<>d.angle_id::text then raise exception 'Recording package revision mismatch'; end if;
 if prev.id is not null and v.data->'packet' is distinct from prev.data->'packet' then raise exception 'Recording snapshot is immutable'; end if;
 if v.data->>'state' not in ('recording_needed','recording_received','transcribed','edit_plan_ready','assets_ready','render_ready','rendered','review','approved') then raise exception 'Invalid production state'; end if;
 if p_job is not null then
  perform 1 from production_jobs where id=p_job and package_id=v.id and package_version=p_expected and lease_token=p_token and status='running' and leased_until>now() for update;
  if not found then raise exception 'Worker lease lost'; end if;
  if v.data->>'state' not in ('transcribed','rendered') then raise exception 'Worker cannot approve production'; end if;
 end if;
 if v.data->>'state'='approved' and (p_job is not null or prev.data->>'state'<>'review' or v.data->'approval'->>'actor' is distinct from p_actor or (v.data->'approval'->>'production_version')::int is distinct from p_expected+1 or v.data->'approval'->>'output_sha256' is distinct from v.data->'output'->>'sha256') then raise exception 'Exact production version approval required'; end if;
 insert into production_packages(id,story_id,draft_id,version,data) values(v.id,sid,d.id,p_expected+1,v.data)
 on conflict(id) do update set data=excluded.data,version=excluded.version,updated_at=now() returning * into v;
 if p_job is not null then update production_jobs set status='succeeded',lease_token=null,leased_until=null where id=p_job; end if;
 return to_jsonb(v);
end $$;
create function public.read_production() returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('packages',coalesce((select jsonb_agg(p order by updated_at desc) from production_packages p),'[]'),
 'jobs',coalesce((select jsonb_agg(to_jsonb(j)-'lease_token' order by created_at desc) from production_jobs j),'[]'),
 'batches',coalesce((select jsonb_agg(b order by created_at desc) from production_batches b),'[]'));
$$;
create function public.queue_production(p_package uuid,p_version integer,p_kind text,p_input jsonb) returns uuid language plpgsql security invoker set search_path=public as $$
declare result uuid; p production_packages; begin
 select * into p from production_packages where id=p_package for update;
 if not found or not p.valid or p.version<>p_version then raise exception 'Conflict: production changed'; end if;
 if p_kind='transcribe' and p.data->>'state'<>'recording_received' or p_kind='render' and p.data->>'state'<>'render_ready' then raise exception 'Production is not ready for this job'; end if;
 insert into production_jobs(package_id,package_version,kind,input) values(p_package,p_version,p_kind,p_input) on conflict(package_id,package_version,kind) do nothing returning id into result;
 if result is null then select id into result from production_jobs where package_id=p_package and package_version=p_version and kind=p_kind; end if;
 return result;
end $$;
create function public.claim_production() returns jsonb language plpgsql security invoker set search_path=public as $$
declare j production_jobs; begin
 update production_jobs pending set status='stale',error='Production revision changed' from production_packages p where pending.package_id=p.id and pending.status in ('queued','running') and (not p.valid or p.version<>pending.package_version);
 update production_jobs set status='failed',error='Worker lease expired on final attempt' where status='running' and leased_until<now() and attempts>=3;
 select * into j from production_jobs where attempts<3 and (status='queued' or status='running' and leased_until<now()) order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update production_jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),leased_until=now()+interval '10 minutes' where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
create function public.heartbeat_production(p_job uuid,p_token uuid) returns void language plpgsql security invoker set search_path=public as $$
begin update production_jobs set leased_until=now()+interval '10 minutes' where id=p_job and lease_token=p_token and status='running' and leased_until>now(); if not found then raise exception 'Worker lease lost'; end if; end $$;
create function public.fail_production(p_job uuid,p_token uuid,p_error text) returns void language plpgsql security invoker set search_path=public as $$
begin update production_jobs set status='failed',error=left(p_error,1500),lease_token=null,leased_until=null where id=p_job and lease_token=p_token and status='running' and leased_until>now(); if not found then raise exception 'Worker lease lost'; end if; end $$;
create function public.retry_production(p_job uuid) returns void language plpgsql security invoker set search_path=public as $$
begin update production_jobs j set status='queued',attempts=0,error=null from production_packages p where j.id=p_job and j.package_id=p.id and p.valid and p.version=j.package_version and j.status='failed'; if not found then raise exception 'Job is not retryable; check the production revision'; end if; end $$;
create function public.get_production_job(p_job uuid,p_token uuid) returns jsonb language sql stable security invoker set search_path=public as $$
 select to_jsonb(j) from production_jobs j where id=p_job and lease_token=p_token and status='running' and leased_until>now();
$$;
create function public.save_production_batch(p_id uuid,p_name text,p_packages jsonb) returns uuid language plpgsql security invoker set search_path=public as $$
declare ids uuid[]:=array(select value::uuid from jsonb_array_elements_text(p_packages)); begin
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) or exists(select 1 from unnest(ids) x where not exists(select 1 from production_packages p where p.id=x and p.valid)) then raise exception 'Choose distinct valid recording packages'; end if;
 insert into production_batches(id,name,package_ids) values(p_id,left(p_name,120),ids); return p_id;
end $$;
do $$ declare t text; f record; begin
 foreach t in array array['production_packages','production_history','production_jobs','production_batches'] loop
 execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t); execute format('grant all on public.%I to service_role',t); end loop;
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('production_audit','invalidate_production','save_production','read_production','queue_production','claim_production','heartbeat_production','fail_production','retry_production','get_production_job','save_production_batch') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature); execute format('grant execute on function %s to service_role',f.signature); end loop;
end $$;
