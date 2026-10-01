-- Live discovery is additive. Existing editorial revisions and approvals stay intact.
create table public.source_registry (
 id text primary key, definition jsonb not null, active boolean not null default false,
 last_success_at timestamptz, last_attempt_at timestamptz, last_error text, etag text, last_modified text
);
create table public.ingestion_runs (
 id uuid primary key, source_id text not null references public.source_registry(id),
 started_at timestamptz not null, completed_at timestamptz,
 status text not null check(status in ('running','success','partial','failed')),
 items_fetched integer not null default 0, new_stories integer not null default 0,
 deduplicated_items integer not null default 0, updated_items integer not null default 0,
 skipped_items integer not null default 0, errors jsonb not null default '[]'
);
create index ingestion_runs_started on public.ingestion_runs(started_at desc);
create table public.story_discovery (
 story_id uuid primary key references public.stories(id), data jsonb not null default '{}'
);
create table public.discovery_records (
 id uuid primary key, registry_id text not null references public.source_registry(id), external_id text not null,
 content_hash text not null, story_id uuid not null references public.stories(id), source_id uuid not null,
 canonical_url text not null, discovered_at timestamptz not null, payload jsonb not null,
 unique(registry_id, external_id, content_hash), foreign key(source_id,story_id) references public.sources(id,story_id)
);
create index discovery_records_url on public.discovery_records(canonical_url);
create index discovery_records_story on public.discovery_records(story_id);
create table public.ingestion_leases (id text primary key, owner uuid not null, expires_at timestamptz not null);
create table public.pilot_events (
 id uuid primary key, story_id uuid not null references public.stories(id),
 kind text not null check(kind in ('surfaced','opened','prioritized','dismissed','research_queued','content_created','manual_miss')),
 brief_id uuid, rank integer check(rank > 0 and rank <= 100), actor text not null, created_at timestamptz not null default now()
);
create unique index pilot_observation_once on public.pilot_events(story_id,kind,actor,coalesce(brief_id,'00000000-0000-0000-0000-000000000000'::uuid)) where kind in ('surfaced','opened');
create index pilot_events_created on public.pilot_events(created_at desc);
do $$ declare tab text; begin
 foreach tab in array array['source_registry','ingestion_runs','story_discovery','discovery_records','ingestion_leases','pilot_events'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from anon, authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
 end loop;
end $$;

alter function public.read_newsroom() rename to read_newsroom_v1;
create function public.read_newsroom() returns jsonb language sql stable security invoker set search_path=public as $$
 select coalesce(jsonb_agg(item || jsonb_build_object('discovery',coalesce(d.data,'{}'::jsonb)) order by item->>'created_at' desc),'[]'::jsonb)
 from jsonb_array_elements(public.read_newsroom_v1()) item left join public.story_discovery d on d.story_id=(item->>'id')::uuid;
$$;
alter function public.save_story(jsonb,integer) rename to save_story_v1;
create function public.save_story(p_story jsonb,p_expected_version integer) returns void language plpgsql security invoker set search_path=public as $$
begin
 perform public.save_story_v1(p_story,p_expected_version);
 if p_story ? 'discovery' then
  insert into public.story_discovery values((p_story->>'id')::uuid,p_story->'discovery') on conflict(story_id) do update set data=excluded.data;
 end if;
end $$;

create function public.ensure_sources(p_sources jsonb) returns void language plpgsql security invoker set search_path=public as $$
declare d jsonb; begin
 for d in select * from jsonb_array_elements(p_sources) loop
  insert into public.source_registry(id,definition,active) values(d->>'id',d,(d->>'active')::boolean)
   on conflict(id) do update set definition=excluded.definition;
 end loop;
end $$;
create function public.set_source_active(p_id text,p_active boolean) returns void language sql security invoker set search_path=public as $$
 update public.source_registry set active=p_active where id=p_id and definition->>'adapter' <> 'manual';
$$;
create function public.read_discovery_state() returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object(
 'registry',coalesce((select jsonb_agg(to_jsonb(r) order by id) from public.source_registry r),'[]'::jsonb),
 'runs',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from public.ingestion_runs order by started_at desc limit 200) r),'[]'::jsonb),
 'records',coalesce((select jsonb_agg(to_jsonb(r)-'payload') from public.discovery_records r),'[]'::jsonb),
 'pilot',coalesce((select jsonb_agg(to_jsonb(p)) from (select * from public.pilot_events order by created_at desc limit 10000) p),'[]'::jsonb));
$$;
create function public.claim_ingestion(p_owner uuid) returns boolean language plpgsql security invoker set search_path=public as $$
declare n integer; begin
 insert into public.ingestion_leases values('discovery',p_owner,now()+interval '15 minutes')
 on conflict(id) do update set owner=excluded.owner,expires_at=excluded.expires_at
 where ingestion_leases.expires_at<now() or ingestion_leases.owner=p_owner;
 get diagnostics n=row_count;
 if n>0 then
  update public.ingestion_runs set status='failed',completed_at=now(),errors=errors || '["Previous worker stopped before completing this source"]'::jsonb where status='running' and started_at < now()-interval '15 minutes';
 end if;
 return n>0;
end $$;
create function public.release_ingestion(p_owner uuid) returns void language sql security invoker set search_path=public as $$
 delete from public.ingestion_leases where id='discovery' and owner=p_owner;
$$;
create function public.save_ingestion_run(p_run jsonb,p_headers jsonb) returns void language plpgsql security invoker set search_path=public as $$
begin
 insert into public.ingestion_runs select * from jsonb_populate_record(null::public.ingestion_runs,p_run)
 on conflict(id) do update set completed_at=excluded.completed_at,status=excluded.status,items_fetched=excluded.items_fetched,new_stories=excluded.new_stories,deduplicated_items=excluded.deduplicated_items,updated_items=excluded.updated_items,skipped_items=excluded.skipped_items,errors=excluded.errors;
 update public.source_registry set last_attempt_at=(p_run->>'started_at')::timestamptz,
 last_success_at=case when p_run->>'status'='success' then (p_run->>'completed_at')::timestamptz else last_success_at end,
 last_error=case when p_run->>'status' in ('partial','failed') then (p_run->'errors')::text when p_run->>'status'='success' then null else last_error end,
 etag=case when p_run->>'status'='success' then coalesce(p_headers->>'etag',etag) else etag end,
 last_modified=case when p_run->>'status'='success' then coalesce(p_headers->>'lastModified',last_modified) else last_modified end
 where id=p_run->>'source_id';
end $$;
create function public.commit_discovery(p_story jsonb,p_expected_version integer,p_record jsonb,p_owner uuid) returns void language plpgsql security invoker set search_path=public as $$
declare previous_status text; begin
 perform 1 from public.ingestion_leases where id='discovery' and owner=p_owner and expires_at>now() for update;
 if not found then raise exception 'Ingestion lease lost; refusing stale worker write'; end if;
 select status into previous_status from public.stories where id=(p_story->>'id')::uuid;
 if coalesce((p_story->>'is_demo')::boolean,true) then raise exception 'Ingestion cannot write demo records'; end if;
 if previous_status is null and p_story->>'status'<>'detected' then raise exception 'Ingestion must create detected stories'; end if;
 if previous_status is not null and p_story->>'status' not in (previous_status,'researched') then raise exception 'Ingestion cannot advance editorial status'; end if;
 perform public.save_story(p_story,p_expected_version);
 insert into public.discovery_records select * from jsonb_populate_record(null::public.discovery_records,p_record);
end $$;
create function public.record_pilot(p_story uuid,p_kind text,p_brief uuid,p_rank integer,p_actor text) returns void language plpgsql security invoker set search_path=public as $$
begin
 if p_kind not in ('surfaced','opened') then raise exception 'This endpoint only accepts observations'; end if;
 if not exists(select 1 from public.stories where id=p_story and not is_demo) then return; end if;
 insert into public.pilot_events(id,story_id,kind,brief_id,rank,actor) values(gen_random_uuid(),p_story,p_kind,p_brief,p_rank,p_actor) on conflict do nothing;
end $$;
create function public.capture_editorial_pilot() returns trigger language plpgsql security invoker set search_path=public as $$
declare kind text; s public.stories; begin
 select * into s from public.stories where id=new.story_id;
 if s.is_demo then return new; end if;
 kind:=case when new.type='priority' and s.priority then 'prioritized' when new.type='archive' and s.archived then 'dismissed'
 when new.type='draft_created' then 'content_created' when new.type='research_requested' then 'research_queued' when new.type='manual_discovery' then 'manual_miss' end;
 if kind is not null then insert into public.pilot_events(id,story_id,kind,actor,created_at) values(new.id,new.story_id,kind,new.actor,new.created_at) on conflict do nothing; end if;
 return new;
end $$;
create trigger editorial_pilot after insert on public.events for each row execute function public.capture_editorial_pilot();
do $$ declare f text; begin
 foreach f in array array['read_newsroom()','save_story(jsonb,integer)','ensure_sources(jsonb)','set_source_active(text,boolean)','read_discovery_state()','claim_ingestion(uuid)','release_ingestion(uuid)','save_ingestion_run(jsonb,jsonb)','commit_discovery(jsonb,integer,jsonb,uuid)','record_pilot(uuid,text,uuid,integer,text)','capture_editorial_pilot()'] loop
  execute 'revoke all on function public.'||f||' from public, anon, authenticated';
  execute 'grant execute on function public.'||f||' to service_role';
 end loop;
end $$;
