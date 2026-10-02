create table public.opportunity_intake (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('consulting','speaking','podcast','event','partnership','sponsorship','data_deletion')),
 name text not null,email text not null,company text not null default '',role text not null default '',details text not null,
 source text not null,consent_at timestamptz not null,privacy_version text not null,request_hash text not null,
 status text not null default 'new' check(status in ('new','reviewed','qualified','not_a_fit','contacted','closed')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(length(name) between 1 and 200 and length(email)<=254 and length(details) between 10 and 4000)
);
create index opportunity_review on public.opportunity_intake(status,created_at desc);
alter table public.opportunity_intake enable row level security;
revoke all on public.opportunity_intake from public,anon,authenticated;
grant all on public.opportunity_intake to service_role;
create function public.submit_opportunity(p_data jsonb,p_hash text) returns void language plpgsql security invoker set search_path=public as $$
begin
 perform pg_advisory_xact_lock(737374);
 if length(p_hash)<>64 or (select count(*) from opportunity_intake where created_at>now()-interval '1 minute')>=20 or (select count(*) from opportunity_intake where request_hash=p_hash and created_at>now()-interval '1 hour')>=5 then raise exception 'Please retry later'; end if;
 insert into opportunity_intake(kind,name,email,company,role,details,source,consent_at,privacy_version,request_hash)
 values(p_data->>'kind',p_data->>'name',lower(p_data->>'email'),coalesce(p_data->>'company',''),coalesce(p_data->>'role',''),p_data->>'details','public-site',now(),'2026-10-02/v2-draft',p_hash);
end $$;
create function public.read_opportunities() returns jsonb language sql stable security invoker set search_path=public as $$ select coalesce(jsonb_agg(r order by created_at desc),'[]') from opportunity_intake r; $$;
create function public.review_opportunity(p_id uuid,p_status text,p_actor text) returns void language plpgsql security invoker set search_path=public as $$
begin
 if p_status not in ('reviewed','qualified','not_a_fit','contacted','closed') then raise exception 'Invalid review state'; end if;
 update opportunity_intake set status=p_status,updated_at=now() where id=p_id;
 insert into control_events(entity_id,kind,actor,epoch,snapshot) values(p_id,'opportunity',p_actor,(select version from control_epoch),jsonb_build_object('status',p_status));
end $$;
alter table public.subscriber_intake add column beehiiv_id text,add column sync_status text not null default 'pending',add column sync_attempts integer not null default 0,add column synced_at timestamptz;
create function public.read_subscribers() returns jsonb language sql stable security invoker set search_path=public as $$ select coalesce(jsonb_agg(to_jsonb(s)-'unsubscribe_hash'),'[]') from subscriber_intake s; $$;
create function public.subscriber_sync_result(p_id uuid,p_external text,p_status text) returns void language sql security invoker set search_path=public as $$ update subscriber_intake set beehiiv_id=coalesce(p_external,beehiiv_id),sync_status=p_status,sync_attempts=sync_attempts+1,synced_at=case when p_status='synced' then now() else synced_at end where id=p_id; $$;
create function public.delete_intake_data(p_email text,p_actor text) returns void language plpgsql security invoker set search_path=public as $$
begin
 delete from opportunity_intake where email=lower(p_email);delete from subscriber_intake where email=lower(p_email);
 insert into control_events(kind,actor,epoch,snapshot) values('pii_deletion',p_actor,(select version from control_epoch),'{"personal_data_removed":true}');
end $$;
create function public.cleanup_activation() returns void language sql security invoker set search_path=public as $$ delete from provider_oauth_attempts where expires_at<now()-interval '7 days'; $$;
do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('submit_opportunity','read_opportunities','review_opportunity','read_subscribers','subscriber_sync_result','delete_intake_data','cleanup_activation') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
