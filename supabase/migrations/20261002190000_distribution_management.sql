-- Explicit authenticated remote draft release/cancellation shares the worker lease.
create function public.claim_distribution_management(p_id uuid,p_demo boolean) returns jsonb language plpgsql security invoker set search_path=public as $$
declare r provider_outbox; begin
 select * into r from provider_outbox where id=p_id and is_demo=p_demo for update;
 if r.id is null or r.status in ('published','cancelled','resolved') or r.lease_until>now() then raise exception 'Distribution unavailable or busy'; end if;
 update provider_outbox set lease_token=gen_random_uuid(),lease_until=now()+interval '4 minutes',updated_at=now() where id=r.id returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function public.claim_distribution_management(uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_distribution_management(uuid,boolean) to service_role;
create or replace function public.recover_provider_outbox(p_id uuid,p_action text,p_actor text,p_demo boolean) returns void language plpgsql security invoker set search_path=public as $$
declare r provider_outbox; begin
 select * into r from provider_outbox where id=p_id and is_demo=p_demo for update;
 if r.id is null or r.status='published' or (r.lease_until>now()) then raise exception 'Outbox cannot be recovered in this state'; end if;
 if p_action='retry' then
  if r.status='uncertain' or r.remote->>'status' in ('dispatching','publishing','cancelling') then raise exception 'Uncertain write: reconcile before retry'; end if;
  if r.status='draft' then raise exception 'Authorize release of the existing draft'; end if;
  update provider_outbox set status='queued',due_at=now(),attempts=0,error=null where id=p_id;
 elsif p_action='reconcile' then
  update provider_outbox set status='dispatching',due_at=now() where id=p_id;
 elsif p_action in ('cancel','resolved') then
  if (r.remote->>'id' is not null or r.status='uncertain' or r.remote->>'status' in ('dispatching','publishing','cancelling')) and r.remote->>'status' is distinct from 'cancelled' then raise exception 'Remote cancellation must be confirmed first'; end if;
  update provider_outbox set status=case when p_action='cancel' then 'cancelled' else 'resolved' end where id=p_id;
 else raise exception 'Unknown recovery action'; end if;
 update provider_outbox set lease_token=null,lease_until=null,history=history||jsonb_build_array(jsonb_build_object('at',now(),'action',p_action,'actor',p_actor)),updated_at=now() where id=p_id;
end $$;
