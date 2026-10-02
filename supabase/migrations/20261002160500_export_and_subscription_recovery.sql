create function public.claim_graphic_export(p_id uuid,p_version integer,p_demo boolean) returns jsonb language plpgsql security invoker set search_path=public as $$
declare j control_jobs; begin
 if not exists(select 1 from control_entities where id=p_id and kind='graphic' and version=p_version and is_demo=p_demo and data->>'rights'='cleared' and data->>'publishable'='true') then raise exception 'Exact cleared raster required'; end if;
 insert into control_jobs(id,kind,entity_id,entity_version,is_demo,idempotency_key,status,due_at,input,retryable) values(gen_random_uuid(),'export',p_id,p_version,p_demo,'carousel-drive:'||p_id||':'||p_version,'queued',now(),'{}',true) on conflict(idempotency_key) do nothing;
 select * into j from control_jobs where idempotency_key='carousel-drive:'||p_id||':'||p_version for update;
 if j.status='succeeded' then return to_jsonb(j)-'lease_token'; end if;
 if j.leased_until>now() or j.status='cancelled' or j.attempts>=3 then raise exception 'Export busy or exhausted; inspect failure inbox'; end if;
 update control_jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),leased_until=now()+interval '5 minutes',updated_at=now() where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
create function public.subscriber_remote_unsubscribe(p_id uuid) returns void language sql security invoker set search_path=public as $$
 update subscriber_intake set status='unsubscribed',updated_at=now(),sync_status='synced',synced_at=now() where id=p_id;
$$;
-- Fresh consent/unsubscribe must become pending for portable sync; never resurrect provider opt-outs.
create or replace function public.unsubscribe_subscriber(p_hash text) returns void language sql security invoker set search_path=public as $$
 update subscriber_intake set status='unsubscribed',sync_status='pending',updated_at=now() where unsubscribe_hash=p_hash;
$$;
-- Public URLs only update surfaces already explicitly approved by the human editor.
create function public.attach_publication_url(p_content uuid,p_version integer,p_url text) returns void language plpgsql security invoker set search_path=public as $$
begin
 if p_url !~ '^https://' or p_url ~ 'example.invalid' then raise exception 'Verified public remote URL required'; end if;
 update public_surface set url=p_url,source_version=p_version where source_id=p_content and exists(select 1 from control_entities c where c.id=p_content and c.version=p_version and c.data->'final_approval' is not null and c.data->'final_approval'<>'null'::jsonb) and approved_by is not null;
end $$;
do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('claim_graphic_export','subscriber_remote_unsubscribe','attach_publication_url') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;

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
  if v.kind='content' and old.id is not null and v.data->'final_approval'=old.data->'final_approval' and v.data->'final_approval'<>'null'::jsonb and p_actor is distinct from old.data->'final_approval'->>'actor' and (v.data-array['distribution_state','analytics_state']) is distinct from (old.data-array['distribution_state','analytics_state']) then raise exception 'Operational actor cannot alter approved content'; end if;
  if v.kind='take' and v.data->>'status'='approved' and (v.data->>'approved_by' is distinct from p_actor or coalesce(v.data->>'approved_at','')='') then raise exception 'Explicit human take approval required'; end if;
  insert into control_entities(id,kind,version,story_id,draft_id,parent_id,is_demo,data) values(v.id,v.kind,v.version,v.story_id,v.draft_id,v.parent_id,v.is_demo,v.data)
   on conflict(id) do update set version=excluded.version,story_id=excluded.story_id,draft_id=excluded.draft_id,parent_id=excluded.parent_id,data=excluded.data,updated_at=now();
  insert into control_events(entity_id,kind,actor,epoch,snapshot) values(v.id,v.kind,p_actor,next_epoch,item);
  -- Previously materialized copy no longer represents the current approved version.
  if v.kind='content' and old.id is not null and (v.data-array['distribution_state','analytics_state'])=(old.data-array['distribution_state','analytics_state']) then
   update public_surface set source_version=v.version where source_id=v.id and source_version=old.version and visible;
  else
   update public_surface set visible=false where source_id=v.id and source_version<>v.version;
  end if;
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
