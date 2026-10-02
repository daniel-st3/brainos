-- Private activation records. Provider tokens never enter control snapshots.
create table public.automation_runs (
 id uuid primary key default gen_random_uuid(), lane text not null check(lane in ('discovery','operations')),
 window_at timestamptz not null, event text not null check(event in ('schedule','manual')),
 status text not null check(status in ('running','success','failed')), started_at timestamptz not null default now(),
 finished_at timestamptz, lease_until timestamptz not null default now()+interval '8 minutes', result jsonb, error text,
 unique(lane,window_at,event)
);
create index automation_recent on public.automation_runs(lane,event,window_at desc);
create function public.claim_automation(p_lane text,p_window timestamptz,p_event text) returns uuid language plpgsql security invoker set search_path=public as $$
declare v uuid; begin
 insert into automation_runs(lane,window_at,event,status) values(p_lane,p_window,p_event,'running')
 on conflict(lane,window_at,event) do update set status='running',started_at=now(),lease_until=now()+interval '8 minutes',error=null
 where automation_runs.status='failed' or (automation_runs.status='running' and automation_runs.lease_until<now()) returning id into v;
 return v;
end $$;
create function public.finish_automation(p_id uuid,p_success boolean,p_result jsonb,p_error text default null) returns void language sql security invoker set search_path=public as $$
 update automation_runs set status=case when p_success then 'success' else 'failed' end,finished_at=now(),result=p_result,error=left(p_error,500) where id=p_id and status='running';
$$;
create function public.read_automation() returns jsonb language sql stable security invoker set search_path=public as $$
 select coalesce(jsonb_agg(r),'[]') from (select * from automation_runs order by started_at desc limit 100) r;
$$;
create table public.provider_oauth_attempts (
 id uuid primary key, provider text not null, actor text not null, state_hash text not null unique, verifier_ciphertext text not null,
 expires_at timestamptz not null, consumed_at timestamptz, created_at timestamptz not null default now()
);
create function public.save_provider_oauth(p_attempt jsonb) returns void language sql security invoker set search_path=public as $$
 insert into provider_oauth_attempts select * from jsonb_populate_record(null::provider_oauth_attempts,p_attempt);
$$;
create function public.consume_provider_oauth(p_hash text,p_actor text,p_provider text) returns jsonb language plpgsql security invoker set search_path=public as $$
declare r provider_oauth_attempts; begin
 update provider_oauth_attempts set consumed_at=now() where state_hash=p_hash and actor=p_actor and provider=p_provider and consumed_at is null and expires_at>now() returning * into r;
 if r.id is null then raise exception 'OAuth state expired, replayed or mismatched'; end if;
 return to_jsonb(r);
end $$;
create function public.provider_secret(p_id uuid,p_ciphertext text default null,p_delete boolean default false) returns text language plpgsql security invoker set search_path=public as $$
declare r text; begin
 if p_delete then delete from provider_credentials where account_id=p_id; return null; end if;
 if p_ciphertext is not null then insert into provider_credentials values(p_id,p_ciphertext,now()) on conflict(account_id) do update set ciphertext=excluded.ciphertext,updated_at=now(); end if;
 select ciphertext into r from provider_credentials where account_id=p_id; return r;
end $$;
-- Logical new domains reuse versioned records and audit history.
alter table public.control_entities drop constraint control_entities_kind_check;
alter table public.control_entities add constraint control_entities_kind_check check(kind in ('brand','idea','content','take','account','package','campaign','newsletter','experiment','review','graphic','quality','decision','question','link','notification','publication','profile','handle','outbox','opportunity','launch_plan'));
create table public.provider_outbox (
 id uuid primary key, package_id uuid not null references control_entities(id), package_version integer not null,
 account_id uuid not null references control_entities(id), provider text not null, is_demo boolean not null,
 checksum text not null, payload jsonb not null, due_at timestamptz not null, idempotency_key text not null unique,
 status text not null default 'queued', attempts integer not null default 0, lease_token uuid, lease_until timestamptz,
 remote jsonb not null default '{}', history jsonb not null default '[]', error text, publication_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index provider_outbox_due on public.provider_outbox(status,due_at) where status in ('queued','processing');
create function public.enqueue_provider_outbox(p_row jsonb) returns uuid language plpgsql security invoker set search_path=public as $$
declare r provider_outbox; v uuid; begin
 r:=jsonb_populate_record(null::provider_outbox,p_row);
 insert into provider_outbox(id,package_id,package_version,account_id,provider,is_demo,checksum,payload,due_at,idempotency_key)
 values(r.id,r.package_id,r.package_version,r.account_id,r.provider,r.is_demo,r.checksum,r.payload,r.due_at,r.idempotency_key)
 on conflict(idempotency_key) do nothing returning id into v;
 if v is null then select id into v from provider_outbox where idempotency_key=r.idempotency_key; end if; return v;
end $$;
create function public.claim_provider_outbox(p_demo boolean) returns jsonb language plpgsql security invoker set search_path=public as $$
declare r provider_outbox; begin
 select * into r from provider_outbox where is_demo=p_demo and due_at<=now() and (status in ('queued','processing') and (lease_until is null or lease_until<now())) order by due_at for update skip locked limit 1;
 if r.id is null then return null; end if;
 -- An uncertain dispatched write must be reconciled, never blindly sent again.
 update provider_outbox set lease_token=gen_random_uuid(),lease_until=now()+interval '4 minutes',attempts=attempts+1,updated_at=now() where id=r.id returning * into r;
 return to_jsonb(r);
end $$;
create function public.update_provider_outbox(p_id uuid,p_token uuid,p_patch jsonb) returns void language plpgsql security invoker set search_path=public as $$
begin
 update provider_outbox set status=coalesce(p_patch->>'status',status),remote=coalesce(p_patch->'remote',remote),
 history=history||jsonb_build_array(jsonb_build_object('at',now(),'status',p_patch->>'status','code',p_patch->>'error')),error=p_patch->>'error',
 due_at=coalesce((p_patch->>'due_at')::timestamptz,due_at),publication_id=coalesce((p_patch->>'publication_id')::uuid,publication_id),
 lease_token=case when coalesce((p_patch->>'release')::boolean,false) then null else lease_token end,
 lease_until=case when coalesce((p_patch->>'release')::boolean,false) then null else lease_until end,updated_at=now()
 where id=p_id and lease_token=p_token and lease_until>now();
 if not found then raise exception 'Outbox lease lost'; end if;
end $$;
create function public.read_provider_outbox(p_demo boolean) returns jsonb language sql stable security invoker set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(r)-'lease_token'),'[]') from provider_outbox r where is_demo=p_demo;
$$;
create function public.install_provider_connection(p_epoch bigint,p_entity jsonb,p_ciphertext text,p_actor text) returns void language plpgsql security invoker set search_path=public as $$
begin
 if p_entity->>'kind'<>'account' then raise exception 'Account required'; end if;
 perform commit_control(p_epoch,jsonb_build_array(p_entity),'[]','[]',p_actor);
 perform provider_secret((p_entity->>'id')::uuid,p_ciphertext,false);
end $$;
create function public.disconnect_provider(p_epoch bigint,p_entity jsonb,p_actor text) returns void language plpgsql security invoker set search_path=public as $$
begin
 if p_entity->>'kind'<>'account' then raise exception 'Account required'; end if;
 perform commit_control(p_epoch,jsonb_build_array(p_entity),'[]','[]',p_actor);
 perform provider_secret((p_entity->>'id')::uuid,null,true);
 update provider_outbox set status='blocked',error='AUTH_REVOKED' where account_id=(p_entity->>'id')::uuid and status<>'published';
end $$;
do $$ declare t text; f record; begin
 foreach t in array array['automation_runs','provider_oauth_attempts','provider_outbox'] loop
 execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t); execute format('grant all on public.%I to service_role',t); end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('claim_automation','finish_automation','read_automation','save_provider_oauth','consume_provider_oauth','provider_secret','enqueue_provider_outbox','claim_provider_outbox','update_provider_outbox','read_provider_outbox','install_provider_connection','disconnect_provider') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature); execute format('grant execute on function %s to service_role',f.signature); end loop;
end $$;
