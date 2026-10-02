-- Additive control plane. Existing discovery, ranking, editorial and media contracts remain intact.
create table public.control_epoch (id boolean primary key default true check(id), version bigint not null default 0);
insert into public.control_epoch values(true,0);
create table public.control_entities (
 id uuid primary key, kind text not null check(kind in ('brand','idea','content','take','account','package','campaign','newsletter','experiment','review','graphic','quality','decision','question','link','notification','publication')),
 version integer not null check(version>0), story_id uuid references public.stories(id), draft_id uuid references public.drafts(id),
 parent_id uuid references public.control_entities(id) deferrable initially deferred,
 is_demo boolean not null default false, data jsonb not null check(jsonb_typeof(data)='object'), updated_at timestamptz not null default now()
);
create index control_entities_kind on public.control_entities(kind,is_demo,updated_at);
create index control_entities_story on public.control_entities(story_id) where story_id is not null;
create index control_entities_parent on public.control_entities(parent_id) where parent_id is not null;
create unique index one_active_brand on public.control_entities(is_demo) where kind='brand' and data->>'status'='active';
create table public.control_events (id bigint generated always as identity primary key, entity_id uuid, kind text not null, actor text not null, epoch bigint not null, snapshot jsonb not null, created_at timestamptz not null default now());
create trigger control_events_immutable before update or delete on public.control_events for each row execute function public.keep_operational_history();
create table public.control_jobs (
 id uuid primary key, kind text not null check(kind in ('distribution','analytics','graphic','export')),
 entity_id uuid not null references public.control_entities(id), entity_version integer not null, is_demo boolean not null default false,
 idempotency_key text not null unique, status text not null check(status in ('queued','blocked','running','succeeded','failed','cancelled','dead_letter')),
 due_at timestamptz not null default now(), attempts integer not null default 0, lease_token uuid, leased_until timestamptz,
 input jsonb not null, result jsonb, error text, retryable boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index control_jobs_due on public.control_jobs(status,due_at);
create table public.public_surface (
 id uuid primary key, kind text not null check(kind in ('profile','content','build','link')), title text not null,
 description text not null, url text, body text not null default '', approved_by text not null, approved_at timestamptz not null,
 source_id uuid not null references public.control_entities(id), source_version integer not null,
 is_demo boolean not null default false, visible boolean not null default true,
 check(url is null or url ~ '^https://'), check(length(title)<=200 and length(description)<=1000 and length(body)<=12000)
);
create table public.subscriber_intake (
 id uuid primary key default gen_random_uuid(), email text not null unique, status text not null check(status in ('active','unsubscribed','bounced')),
 consent_at timestamptz not null, source text not null, privacy_version text not null, unsubscribe_hash text not null,
 updated_at timestamptz not null default now(), check(length(email)<=254)
);
create table public.provider_credentials (account_id uuid primary key references public.control_entities(id), ciphertext text not null, updated_at timestamptz not null default now());
create table public.worker_presence (id text primary key, protocol integer not null, version text not null, capabilities text[] not null, active_job uuid, last_seen timestamptz not null default now());
-- service-role-only transactions; all human actions are authenticated/CSRF checked by the application.
create function public.read_control() returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('epoch',(select version from control_epoch),'entities',coalesce((select jsonb_agg(e order by updated_at desc) from control_entities e),'[]'),
 'jobs',coalesce((select jsonb_agg(to_jsonb(j)-'lease_token' order by created_at desc) from control_jobs j),'[]'),
 'events',coalesce((select jsonb_agg(e) from (select id,entity_id,kind,actor,epoch,created_at from control_events order by id desc limit 100) e),'[]'),
 'workers',coalesce((select jsonb_agg(w) from worker_presence w),'[]'));
$$;
create function public.commit_control(p_epoch bigint,p_entities jsonb,p_jobs jsonb,p_public jsonb,p_actor text,p_lease_id uuid default null,p_lease_token uuid default null) returns bigint language plpgsql security invoker set search_path=public as $$
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
  if v.kind='content' and v.data->>'final_approval' is not null and v.data->>'final_approval'<>'null' and coalesce(v.data->'final_approval'->>'actor','')<>p_actor then raise exception 'Human final approval required'; end if;
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
create function public.read_public_surface(p_demo boolean default false) returns jsonb language sql stable security invoker set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'title',title,'description',description,'url',url,'body',body) order by kind,title),'[]') from public_surface where visible and is_demo=p_demo;
$$;
create function public.signup_subscriber(p_email text,p_source text,p_hash text,p_privacy text) returns void language plpgsql security invoker set search_path=public as $$
begin
 if length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_source not in ('public-site','newsletter') or length(p_hash)<>64 then raise exception 'Valid email and consent required'; end if;
 perform pg_advisory_xact_lock(737373);
 if (select count(*) from subscriber_intake where updated_at>now()-interval '1 minute')>=30 then raise exception 'Please retry later'; end if;
 insert into subscriber_intake(email,status,consent_at,source,privacy_version,unsubscribe_hash) values(lower(p_email),'active',now(),p_source,p_privacy,p_hash)
 on conflict(email) do update set status='active',consent_at=now(),source=excluded.source,privacy_version=excluded.privacy_version,unsubscribe_hash=excluded.unsubscribe_hash,updated_at=now();
end $$;
create function public.unsubscribe_subscriber(p_hash text) returns void language sql security invoker set search_path=public as $$ update subscriber_intake set status='unsubscribed',updated_at=now() where unsubscribe_hash=p_hash; $$;
create function public.worker_checkin(p_id text,p_protocol integer,p_version text,p_capabilities jsonb,p_active uuid default null) returns void language sql security invoker set search_path=public as $$
 insert into worker_presence values(left(p_id,100),p_protocol,left(p_version,100),array(select jsonb_array_elements_text(p_capabilities)),p_active,now()) on conflict(id) do update set protocol=excluded.protocol,version=excluded.version,capabilities=excluded.capabilities,active_job=excluded.active_job,last_seen=now();
$$;
create function public.claim_control_job(p_kind text,p_demo boolean) returns jsonb language plpgsql security invoker set search_path=public as $$
declare j control_jobs; begin
 update control_jobs set status='dead_letter',error='Lease expired after three attempts',lease_token=null,leased_until=null where status='running' and leased_until<now() and attempts>=3;
 select * into j from control_jobs where kind=p_kind and is_demo=p_demo and due_at<=now() and attempts<3 and (status='queued' or status='running' and leased_until<now()) order by due_at for update skip locked limit 1;
 if not found then return null; end if;
 update control_jobs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),leased_until=now()+interval '5 minutes',updated_at=now() where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
create function public.finish_control_job(p_id uuid,p_token uuid,p_status text,p_result jsonb,p_error text,p_retryable boolean) returns void language plpgsql security invoker set search_path=public as $$
begin
 if p_status not in ('succeeded','blocked','failed','dead_letter') then raise exception 'Invalid job outcome'; end if;
 update control_jobs set status=p_status,result=p_result,error=left(p_error,1500),retryable=p_retryable,lease_token=null,leased_until=null,updated_at=now() where id=p_id and lease_token=p_token and status='running' and leased_until>now();
 if not found then raise exception 'Job lease lost'; end if;
end $$;
create function public.recover_control_job(p_id uuid,p_cancel boolean) returns void language plpgsql security invoker set search_path=public as $$
begin
 update control_jobs set status=case when p_cancel then 'cancelled' else 'queued' end,error=null,attempts=case when p_cancel then attempts else 0 end,updated_at=now() where id=p_id and (status in ('blocked','failed','dead_letter') or p_cancel and status='queued');
 if not found then raise exception 'Job cannot be recovered in this state'; end if;
end $$;
-- The existing immutable draft boundary now records deterministic quality issues on every new revision.
create function public.control_draft_quality() returns trigger language plpgsql security invoker set search_path=public as $$
declare issues jsonb:='[]'; rule jsonb; rules jsonb; excerpt text; copy text:=new.hook||E'\n'||new.body||E'\n'||new.cta; begin
 select data->'rules' into rules from control_entities where kind='brand' and data->>'status'='active' and is_demo=(select is_demo from stories where id=new.story_id);
 rules:=coalesce(rules,'[{"id":"contrast","pattern":"No es .{1,100},? (es|sino) .{1,100}","severity":"medium","remediation":"State the concrete point directly"},{"id":"generic_question","pattern":"¿Por qué importa|¿Qué probarías|¿Qué opinas","severity":"medium","remediation":"Offer a specific useful next action"},{"id":"ai_phrase","pattern":"Hay un matiz importante|en el mundo de hoy|revolucionari[oa]|game.?changer|sin lugar a dudas","severity":"medium","remediation":"Replace canned language with evidence"},{"id":"false_experience","pattern":"yo probé|he probado|mi experiencia demuestra|comprobé personalmente","severity":"high","remediation":"Require evidence of Daniel performing this test"}]'::jsonb);
 for rule in select value from jsonb_array_elements(rules) loop
 begin
 excerpt:=substring(copy from '(?i)'||(rule->>'pattern'));
 if excerpt is not null then issues:=issues||jsonb_build_array(jsonb_build_object('rule',rule->>'id','severity',rule->>'severity','excerpt',excerpt,'start',position(excerpt in copy)-1,'end',position(excerpt in copy)-1+length(excerpt),'remediation',rule->>'remediation','review_status','open')); end if;
 exception when invalid_regular_expression then issues:=issues||jsonb_build_array(jsonb_build_object('rule',rule->>'id','severity','high','excerpt','','start',0,'end',0,'remediation','Rule syntax requires repair; draft was not mutated','review_status','open'));
 end;
 end loop;
 insert into control_entities(id,kind,version,story_id,draft_id,is_demo,data) values(new.id,'quality',1,new.story_id,new.id,(select is_demo from stories where id=new.story_id),jsonb_build_object('draft_id',new.id,'draft_revision',new.revision,'algorithm','deterministic-quality/v1','created_at',now(),'issues',issues));
 return new;
end $$;
create trigger control_draft_quality after insert on public.drafts for each row execute function public.control_draft_quality();
-- Direct client access is denied except the deliberately narrow public read model.
do $$ declare t text; f record; begin
 foreach t in array array['control_epoch','control_entities','control_events','control_jobs','public_surface','subscriber_intake','provider_credentials','worker_presence'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and (proname like '%control%' or proname in ('read_public_surface','signup_subscriber','unsubscribe_subscriber','worker_checkin')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
grant select(id,kind,title,description,url,body,visible,is_demo) on public.public_surface to anon,authenticated;
create policy public_approved_surface on public.public_surface for select to anon,authenticated using (visible and not is_demo);
grant execute on function public.read_public_surface(boolean) to anon,authenticated;
grant usage,select on sequence public.control_events_id_seq to service_role;

-- Both logical publication paths are unique per exact package revision, even under concurrent requests.
create unique index control_publication_once on public.control_entities((data->>'package_id'),(data->>'package_version'),is_demo) where kind='publication';
