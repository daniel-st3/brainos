-- Separate staging snapshots. No writes to stories, source_registry, pilot, approvals or outbox.
create table public.creator_discovery_runs (
 slot text primary key check (slot ~ '^\d{4}-\d{2}-\d{2}T\d{2}$'),
 owner uuid not null, status text not null check(status in ('running','complete')),
 started_at timestamptz not null default now(), completed_at timestamptz,
 snapshot jsonb, check(snapshot is null or coalesce((snapshot->>'schema'='creator-discovery/v1' and snapshot->>'stage'='STAGING' and snapshot->>'output'='STORY_BRIEFS_ONLY'),false))
);
alter table public.creator_discovery_runs enable row level security;
revoke all on public.creator_discovery_runs from public,anon,authenticated;
grant all on public.creator_discovery_runs to service_role;
create function public.claim_creator_run(p_slot text,p_owner uuid) returns boolean language plpgsql security invoker set search_path=public as $$
begin
 insert into creator_discovery_runs(slot,owner,status) values(p_slot,p_owner,'running')
 on conflict(slot) do update set owner=excluded.owner,started_at=now()
 where creator_discovery_runs.status='running' and creator_discovery_runs.started_at<now()-interval '10 minutes';
 return found;
end $$;
create function public.finish_creator_run(p_slot text,p_owner uuid,p_snapshot jsonb) returns void language plpgsql security invoker set search_path=public as $$
begin
 if octet_length(p_snapshot::text)>1000000 then raise exception 'Snapshot too large'; end if;
 update creator_discovery_runs set status='complete',completed_at=now(),snapshot=p_snapshot
 where slot=p_slot and owner=p_owner and status='running';
 if not found then raise exception 'Creator lease lost'; end if;
end $$;
create function public.read_creator_runs() returns jsonb language sql stable security invoker set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(r)-'owner'),'[]') from (select * from creator_discovery_runs order by slot desc limit 10) r;
$$;
revoke all on function public.claim_creator_run(text,uuid),public.finish_creator_run(text,uuid,jsonb),public.read_creator_runs() from public,anon,authenticated;
grant execute on function public.claim_creator_run(text,uuid),public.finish_creator_run(text,uuid,jsonb),public.read_creator_runs() to service_role;
