-- Durable operational queue, separate from editorial workflow and pilot ranking.
create table public.operation_jobs (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('enrich','draft','production','analytics','post_recording')),
 dedupe_key text not null unique, story_id uuid references public.stories(id),
 payload jsonb not null default '{}', status text not null default 'queued' check(status in ('queued','running','succeeded','failed','blocked')),
 attempts integer not null default 0 check(attempts>=0), max_attempts integer not null default 3 check(max_attempts between 1 and 5),
 available_at timestamptz not null default now(), leased_until timestamptz, lease_token uuid,
 result jsonb, error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index operation_jobs_due_idx on public.operation_jobs(status,available_at);
create index operation_jobs_story_idx on public.operation_jobs(story_id);
create table public.generation_records (
 id uuid primary key default gen_random_uuid(), job_id uuid not null unique references public.operation_jobs(id),
 story_id uuid not null references public.stories(id), kind text not null, provider text not null,
 model text, input_fingerprint text not null, source_ids uuid[] not null, output jsonb not null,
 generated_at timestamptz not null default now(), human_verified boolean not null default false check(not human_verified)
);
create index generation_story_idx on public.generation_records(story_id);
create table public.opinion_memory (
 id uuid primary key default gen_random_uuid(), topic text not null check(length(topic) between 1 and 200),
 take text not null check(length(take) between 1 and 12000), context text not null,
 story_id uuid not null references public.stories(id), angle_id uuid not null,
 confirmed_by text not null check(length(confirmed_by)>0), confirmed_at timestamptz not null default now(),
 explicit_confirmation boolean not null check(explicit_confirmation),
 supersedes uuid unique references public.opinion_memory(id),
 foreign key(angle_id,story_id) references public.angles(id,story_id)
);
create index opinion_story_idx on public.opinion_memory(story_id);
create index opinion_angle_idx on public.opinion_memory(angle_id,story_id);
create table public.media_objects (
 id uuid primary key default gen_random_uuid(), story_id uuid not null references public.stories(id),
 draft_id uuid, provider text not null check(provider in ('supabase','drive','local')),
 file_id text not null, folder_id text, mime_type text not null, name text not null,
 bytes bigint check(bytes>=0), sha256 text, origin text not null,
 asset_id uuid, created_at timestamptz not null default now(), created_by text not null,
 unique(provider,file_id), foreign key(draft_id,story_id) references public.drafts(id,story_id),
 foreign key(asset_id,story_id) references public.assets(id,story_id)
);
create index media_story_idx on public.media_objects(story_id);
create index media_draft_idx on public.media_objects(draft_id,story_id);
create index media_asset_idx on public.media_objects(asset_id,story_id);
create table public.newsletter_issues (
 id uuid primary key default gen_random_uuid(), title text not null,
 status text not null default 'draft' check(status in ('draft','review','approved','integration_required','published_manual')),
 created_at timestamptz not null default now(), approved_by text, approved_at timestamptz
);
create table public.newsletter_sections (
 issue_id uuid not null references public.newsletter_issues(id), position integer not null check(position>=0),
 story_id uuid not null references public.stories(id), draft_id uuid not null,
 primary key(issue_id,position), unique(issue_id,draft_id),
 foreign key(draft_id,story_id) references public.drafts(id,story_id)
);
create index newsletter_sections_draft_idx on public.newsletter_sections(draft_id,story_id);
create index newsletter_sections_story_idx on public.newsletter_sections(story_id);
create table public.analytics_snapshots (
 id uuid primary key default gen_random_uuid(), publication_id uuid not null references public.publications(id),
 provider text not null check(provider in ('x','instagram','tiktok','youtube','newsletter')),
 window_hours integer not null check(window_hours in (24,72,168)),
 provider_post_id text not null, measured_at timestamptz not null default now(), raw_metrics jsonb not null,
 unique(publication_id,provider,window_hours)
);
create index analytics_publication_idx on public.analytics_snapshots(publication_id);
-- Content and opinion provenance is immutable. Supersession creates another row.
create function public.keep_operational_history() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Operational provenance is append-only'; end $$;
create trigger generation_immutable before update or delete on public.generation_records for each row execute function public.keep_operational_history();
create trigger opinion_immutable before update or delete on public.opinion_memory for each row execute function public.keep_operational_history();
create trigger analytics_immutable before update or delete on public.analytics_snapshots for each row execute function public.keep_operational_history();
create function public.enqueue_operation(p_kind text,p_key text,p_story uuid,p_payload jsonb default '{}',p_due timestamptz default now()) returns uuid language plpgsql security invoker set search_path=public as $$
declare result uuid; begin
 insert into operation_jobs(kind,dedupe_key,story_id,payload,available_at) values(p_kind,p_key,p_story,p_payload,p_due)
 on conflict(dedupe_key) do nothing returning id into result;
 if result is null then select id into result from operation_jobs where dedupe_key=p_key; end if;
 return result;
end $$;
create function public.claim_operation() returns jsonb language plpgsql security invoker set search_path=public as $$
declare job operation_jobs; begin
 -- Expired final attempts become visibly failed instead of remaining running forever.
 update operation_jobs set status='failed',error='Worker lease expired on final attempt',updated_at=now()
 where status='running' and leased_until<now() and attempts>=max_attempts;
 select * into job from operation_jobs where attempts<max_attempts and
 ((status='queued' and available_at<=now()) or (status='running' and leased_until<now()))
 order by available_at,created_at for update skip locked limit 1;
 if not found then return null; end if;
 update operation_jobs set status='running',attempts=attempts+1,leased_until=now()+interval '5 minutes',lease_token=gen_random_uuid(),updated_at=now()
 where id=job.id returning * into job;
 return to_jsonb(job);
end $$;
create function public.finish_operation(p_id uuid,p_token uuid,p_status text,p_result jsonb default null,p_error text default null) returns void language plpgsql security invoker set search_path=public as $$
begin
 if p_status not in ('succeeded','failed','blocked') then raise exception 'Invalid terminal status'; end if;
 update operation_jobs set status=case when p_status='failed' and attempts<max_attempts then 'queued' else p_status end,
 result=p_result,error=left(p_error,2000),available_at=now()+interval '5 minutes',leased_until=null,lease_token=null,updated_at=now()
 where id=p_id and lease_token=p_token and status='running' and leased_until>now();
 if not found then raise exception 'Worker lease lost'; end if;
end $$;
create function public.record_generation(p_job uuid,p_token uuid,p_provider text,p_fingerprint text,p_sources jsonb,p_output jsonb) returns void language plpgsql security invoker set search_path=public as $$
declare j operation_jobs; begin
 select * into j from operation_jobs where id=p_job and lease_token=p_token and status='running' and leased_until>now() for update;
 if not found then raise exception 'Worker lease lost'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_sources) s where not exists(select 1 from sources where id=s::uuid and story_id=j.story_id)) then raise exception 'Source belongs to another story'; end if;
 insert into generation_records(job_id,story_id,kind,provider,input_fingerprint,source_ids,output)
 values(j.id,j.story_id,j.kind,p_provider,p_fingerprint,array(select value::uuid from jsonb_array_elements_text(p_sources)),p_output) on conflict(job_id) do nothing;
end $$;
create function public.confirm_opinion(p_story uuid,p_angle uuid,p_topic text,p_context text,p_actor text,p_confirmed boolean,p_supersedes uuid default null) returns uuid language plpgsql security invoker set search_path=public as $$
declare a angles; result uuid; begin
 if p_confirmed is distinct from true then raise exception 'Explicit human confirmation required'; end if;
 select * into a from angles where id=p_angle and story_id=p_story and approval_state='approved' and approved_by=p_actor;
 if not found then raise exception 'An angle explicitly approved by this editor is required'; end if;
 if p_supersedes is not null then
 perform 1 from opinion_memory where id=p_supersedes and confirmed_by=p_actor for update;
 if not found then raise exception 'Prior opinion missing or belongs to another editor'; end if;
 end if;
 insert into opinion_memory(topic,take,context,story_id,angle_id,confirmed_by,explicit_confirmation,supersedes)
 values(p_topic,a.text,p_context,p_story,p_angle,p_actor,true,p_supersedes) returning id into result;
 return result;
end $$;
create function public.read_operations() returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('jobs',coalesce((select jsonb_agg(j) from (select * from operation_jobs order by created_at desc limit 200) j),'[]'),
 'generations',coalesce((select jsonb_agg(g) from (select * from generation_records order by generated_at desc limit 200) g),'[]'),
 'opinions',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('current',not exists(select 1 from opinion_memory n where n.supersedes=o.id))) from opinion_memory o),'[]'));
$$;
create function public.record_media(p_media jsonb) returns uuid language plpgsql security invoker set search_path=public as $$
declare m media_objects; result uuid; begin
 m:=jsonb_populate_record(null::media_objects,p_media);
 insert into media_objects(id,story_id,draft_id,provider,file_id,folder_id,mime_type,name,bytes,sha256,origin,asset_id,created_by)
 values(coalesce(m.id,gen_random_uuid()),m.story_id,m.draft_id,m.provider,m.file_id,m.folder_id,m.mime_type,m.name,m.bytes,m.sha256,m.origin,m.asset_id,m.created_by)
 on conflict(provider,file_id) do nothing returning id into result;
 if result is null then select id into result from media_objects where provider=m.provider and file_id=m.file_id; end if;
 return result;
end $$;
create function public.record_analytics(p_publication uuid,p_provider text,p_window integer,p_post_id text,p_metrics jsonb) returns void language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from publications where id=p_publication and status='published_manual' and published_url is not null) then raise exception 'Confirmed publication required'; end if;
 insert into analytics_snapshots(publication_id,provider,window_hours,provider_post_id,raw_metrics)
 values(p_publication,p_provider,p_window,p_post_id,p_metrics) on conflict(publication_id,provider,window_hours) do nothing;
end $$;
-- Private server API only, consistent with existing newsroom authorization.
do $$ declare t text; f record; begin
 foreach t in array array['operation_jobs','generation_records','opinion_memory','media_objects','newsletter_issues','newsletter_sections','analytics_snapshots'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in
 ('keep_operational_history','enqueue_operation','claim_operation','finish_operation','record_generation','confirm_opinion','read_operations','record_media','record_analytics') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

-- Fence story writes with the live job lease. All editorial invariants still run.
create function public.commit_operation_story(p_job uuid,p_token uuid,p_story jsonb,p_version integer) returns void language plpgsql security invoker set search_path=public as $$
begin
 perform 1 from operation_jobs where id=p_job and lease_token=p_token and status='running' and leased_until>now() and story_id=(p_story->>'id')::uuid for update;
 if not found then raise exception 'Worker lease lost'; end if;
 perform save_story(p_story,p_version);
end $$;
revoke all on function public.commit_operation_story(uuid,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.commit_operation_story(uuid,uuid,jsonb,integer) to service_role;
