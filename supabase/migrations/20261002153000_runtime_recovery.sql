-- Recover interrupted dispatch through reconciliation; redact bearer-like upload URLs.
create or replace function public.claim_provider_outbox(p_demo boolean) returns jsonb language plpgsql security invoker set search_path=public as $$
declare r provider_outbox; begin
 select * into r from provider_outbox where is_demo=p_demo and due_at<=now() and status in ('queued','processing','dispatching') and (lease_until is null or lease_until<now()) order by due_at for update skip locked limit 1;
 if r.id is null then return null; end if;
 update provider_outbox set lease_token=gen_random_uuid(),lease_until=now()+interval '4 minutes',attempts=attempts+1,updated_at=now() where id=r.id returning * into r;
 return to_jsonb(r);
end $$;
drop index public.provider_outbox_due;
create index provider_outbox_due on public.provider_outbox(is_demo,due_at) where status in ('queued','processing','dispatching');
create or replace function public.read_provider_outbox(p_demo boolean) returns jsonb language sql stable security invoker set search_path=public as $$
 select coalesce(jsonb_agg((to_jsonb(r)-'lease_token')||jsonb_build_object('remote',r.remote-'upload_url')),'[]') from provider_outbox r where is_demo=p_demo;
$$;
create function public.recover_provider_outbox(p_id uuid,p_action text,p_actor text,p_demo boolean) returns void language plpgsql security invoker set search_path=public as $$
declare r provider_outbox; begin
 select * into r from provider_outbox where id=p_id and is_demo=p_demo for update;
 if r.id is null or r.status='published' or (r.lease_until>now()) then raise exception 'Outbox cannot be recovered in this state'; end if;
 if p_action='retry' then
  if r.status='uncertain' or r.remote->>'status' in ('dispatching','publishing') then raise exception 'Uncertain write: reconcile before retry'; end if;
  update provider_outbox set status='queued',due_at=now(),attempts=0,error=null where id=p_id;
 elsif p_action='reconcile' then
  update provider_outbox set status='dispatching',due_at=now() where id=p_id;
 elsif p_action in ('cancel','resolved') then
  update provider_outbox set status=p_action where id=p_id;
 else raise exception 'Unknown recovery action'; end if;
 update provider_outbox set lease_token=null,lease_until=null,history=history||jsonb_build_array(jsonb_build_object('at',now(),'action',p_action,'actor',p_actor)),updated_at=now() where id=p_id;
end $$;
-- Rotating refresh tokens must have a single holder and compare-and-swap persistence.
alter table public.provider_credentials add column refresh_lease uuid, add column refresh_until timestamptz;
create function public.claim_provider_refresh(p_id uuid,p_expected text,p_token uuid) returns boolean language plpgsql security invoker set search_path=public as $$
begin
 update provider_credentials set refresh_lease=p_token,refresh_until=now()+interval '45 seconds' where account_id=p_id and ciphertext=p_expected and (refresh_until is null or refresh_until<now());
 return found;
end $$;
create function public.finish_provider_refresh(p_id uuid,p_token uuid,p_ciphertext text) returns void language plpgsql security invoker set search_path=public as $$
begin
 update provider_credentials set ciphertext=coalesce(p_ciphertext,ciphertext),updated_at=now(),refresh_lease=null,refresh_until=null where account_id=p_id and refresh_lease=p_token and refresh_until>now();
 if not found then raise exception 'Refresh lease lost'; end if;
end $$;
-- Maintain human approval identity on operational state changes, without allowing a new approval.
create or replace function public.commit_control(p_epoch bigint,p_entities jsonb,p_jobs jsonb,p_public jsonb,p_actor text,p_lease_id uuid default null,p_lease_token uuid default null) returns bigint language plpgsql security invoker set search_path=public as $$
declare cur bigint; next_epoch bigint; item jsonb; old control_entities; v control_entities; job control_jobs; surf public_surface; begin
 if p_lease_id is not null then
 perform 1 from control_jobs where id=p_lease_id and lease_token=p_lease_token and status='running' and leased_until>now() for update;
 if not found then raise exception 'Job lease lost before output commit'; end if;
 if not exists(select 1 from jsonb_array_elements(p_entities) e join control_jobs j on j.entity_id=(e->>'id')::uuid where j.id=p_lease_id) then raise exception 'Job/output entity mismatch'; end if;
 end if;
 select version into cur from control_epoch where id=true for update;
 if cur<>p_epoch then raise exception 'Conflict: control plane changed; refresh'; end if;
 if length(p_actor)<1 then raise exception 'Actor required'; end if;
 next_epoch:=cur+1;
 for item in select value from jsonb_array_elements(p_entities) loop
  v:=jsonb_populate_record(null::control_entities,item);
  select * into old from control_entities where id=v.id;
  if (old.id is null and v.version<>1) or (old.id is not null and (v.version<>old.version+1 or v.kind<>old.kind or v.is_demo<>old.is_demo)) then raise exception 'Conflict: entity revision changed'; end if;
  if old.id is not null and old.kind in ('brand','newsletter','package','take') and old.data->>'status' in ('active','approved') and v.data is distinct from old.data and v.data->>'status' not in ('superseded','draft','invalidated') then raise exception 'Approved revision is immutable; create a new revision'; end if;
  if v.kind='content' and v.draft_id is not null and not exists(select 1 from drafts where id=v.draft_id and story_id=v.story_id) then raise exception 'Content draft/story mismatch'; end if;
  if v.kind='content' and v.data->>'content_state'='approved' and not exists(select 1 from drafts d join stories s on s.id=d.story_id join angles a on a.id=d.angle_id where d.id=v.draft_id and d.status='approved' and a.approval_state='approved' and s.research_confirmed and s.active_draft_id=d.id and d.revision=(v.data->>'draft_revision')::integer) then raise exception 'Approved exact draft and angle required'; end if;
  if v.kind='content' and v.data->>'final_approval' is not null and v.data->>'final_approval'<>'null' and v.data->'final_approval' is distinct from old.data->'final_approval' and coalesce(v.data->'final_approval'->>'actor','')<>p_actor then raise exception 'Human final approval required'; end if;
  if v.kind='take' and v.data->>'status'='approved' and (v.data->>'approved_by' is distinct from p_actor or coalesce(v.data->>'approved_at','')='') then raise exception 'Explicit human take approval required'; end if;
  insert into control_entities(id,kind,version,story_id,draft_id,parent_id,is_demo,data) values(v.id,v.kind,v.version,v.story_id,v.draft_id,v.parent_id,v.is_demo,v.data)
   on conflict(id) do update set version=excluded.version,story_id=excluded.story_id,draft_id=excluded.draft_id,parent_id=excluded.parent_id,data=excluded.data,updated_at=now();
  insert into control_events(entity_id,kind,actor,epoch,snapshot) values(v.id,v.kind,p_actor,next_epoch,item);
  -- Previously materialized copy no longer represents the current approved version.
  update public_surface set visible=false where source_id=v.id and source_version<>v.version;
 end loop;
 for item in select value from jsonb_array_elements(p_jobs) loop
  job:=jsonb_populate_record(null::control_jobs,item);
  insert into control_jobs(id,kind,entity_id,entity_version,is_demo,idempotency_key,status,due_at,input,error,retryable)
  values(job.id,job.kind,job.entity_id,job.entity_version,job.is_demo,job.idempotency_key,job.status,job.due_at,job.input,job.error,coalesce(job.retryable,false)) on conflict(idempotency_key) do nothing;
 end loop;
 for item in select value from jsonb_array_elements(p_public) loop
  surf:=jsonb_populate_record(null::public_surface,item);
  select * into v from control_entities where id=surf.source_id;
  if v.id is null or v.version<>surf.source_version or v.is_demo<>surf.is_demo or v.data->>'status' not in ('active','approved','published') then raise exception 'Current explicitly approved public source required'; end if;
  if v.kind='content' and (v.data->'final_approval' is null or v.data->'final_approval'='null'::jsonb) then raise exception 'Final public content approval required'; end if;
  if surf.approved_by<>p_actor then raise exception 'Human public approval required'; end if;
  insert into public_surface values(surf.*) on conflict(id) do update set title=excluded.title,description=excluded.description,url=excluded.url,body=excluded.body,approved_by=excluded.approved_by,approved_at=excluded.approved_at,source_version=excluded.source_version,visible=true;
 end loop;
 update control_epoch set version=next_epoch where id=true;
 if p_lease_id is not null then update control_jobs set status='succeeded',result=jsonb_build_object('sha256',p_entities->0->'data'->>'sha256'),error=null,lease_token=null,leased_until=null,updated_at=now() where id=p_lease_id; end if;
 return next_epoch;
end $$;
do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('recover_provider_outbox','claim_provider_refresh','finish_provider_refresh') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature); execute format('grant execute on function %s to service_role',f.signature); end loop;
end $$;
create or replace function public.provider_secret(p_id uuid,p_ciphertext text default null,p_delete boolean default false) returns text language plpgsql security invoker set search_path=public as $$
declare r text; begin
 if p_delete then delete from provider_credentials where account_id=p_id; return null; end if;
 if p_ciphertext is not null then insert into provider_credentials(account_id,ciphertext,updated_at) values(p_id,p_ciphertext,now()) on conflict(account_id) do update set ciphertext=excluded.ciphertext,updated_at=now(); end if;
 select ciphertext into r from provider_credentials where account_id=p_id; return r;
end $$;
