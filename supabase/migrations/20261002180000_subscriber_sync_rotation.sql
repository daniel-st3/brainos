-- Pending subscriber changes must not sit behind the same first 100 synced rows.
alter table public.subscriber_intake add column checked_at timestamptz;
update public.subscriber_intake set sync_attempts=0,checked_at=synced_at where sync_status='synced';

create function public.read_subscriber_sync_batch() returns jsonb language sql stable security invoker set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(s)-'unsubscribe_hash' order by priority,checked_at nulls first,updated_at,id),'[]')
 from (
  select s.*,case when sync_status='synced' then 1 else 0 end as priority
  from subscriber_intake s
  where consent_at is not null and sync_attempts<3
   and (sync_status<>'synced' or (status='active' and beehiiv_id is not null))
  order by case when sync_status='synced' then 1 else 0 end,checked_at nulls first,updated_at,id
  limit 100
 ) s;
$$;

create function public.subscriber_sync_checked(p_id uuid) returns void language sql security invoker set search_path=public as $$
 update subscriber_intake set checked_at=now() where id=p_id;
$$;

drop function public.subscriber_sync_result(uuid,text,text);
create function public.subscriber_sync_result(p_id uuid,p_external text,p_status text,p_expected_status text default null) returns void language sql security invoker set search_path=public as $$
 update subscriber_intake set beehiiv_id=coalesce(p_external,beehiiv_id),
  sync_status=case when p_expected_status is not null and status<>p_expected_status then 'pending' else p_status end,
  sync_attempts=case when p_status='synced' or (p_expected_status is not null and status<>p_expected_status) then 0 else sync_attempts+1 end,
  synced_at=case when p_status='synced' then now() else synced_at end,
  checked_at=case when p_expected_status is not null and status<>p_expected_status then null when p_status='synced' then now() else checked_at end where id=p_id;
$$;

create or replace function public.subscriber_remote_unsubscribe(p_id uuid) returns void language sql security invoker set search_path=public as $$
 update subscriber_intake set status='unsubscribed',updated_at=now(),sync_status='synced',sync_attempts=0,synced_at=now(),checked_at=now() where id=p_id;
$$;

-- A newly requested opt-out receives a fresh retry budget, even after older failures.
create or replace function public.unsubscribe_subscriber(p_hash text) returns void language sql security invoker set search_path=public as $$
 update subscriber_intake set status='unsubscribed',sync_status='pending',sync_attempts=0,checked_at=null,updated_at=now() where unsubscribe_hash=p_hash;
$$;

do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('read_subscriber_sync_batch','subscriber_sync_checked','subscriber_sync_result') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
