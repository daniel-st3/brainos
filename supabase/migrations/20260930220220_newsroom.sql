-- Content OS: normalized records; all mutations go through the authenticated server domain.
-- service_role is server-only. Browser roles have no access to newsroom records or RPCs.
create table public.stories (
  id uuid primary key,
  title text not null,
  summary text not null,
  status text not null check(status in ('detected','verified','researched','angle_ready','drafted','assets_cleared','recording_needed','render_ready','review','approved','scheduled','published','measured')),
  pillar text not null,
  story_type text not null,
  primary_language text not null,
  discovered_at timestamptz not null,
  published_at timestamptz,
  urgency text not null,
  confidence text not null,
  audience_relevance text not null,
  latam_relevance text not null,
  commercial_relevance text not null,
  why_matters text not null,
  latam_reason text not null,
  research_notes text not null,
  research_confirmed boolean not null default false,
  priority boolean not null default false,
  archived boolean not null default false,
  is_demo boolean not null default false,
  active_draft_id uuid,
  production_completed boolean not null default false,
  production_checklist text[] not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  version integer not null default 0);
alter table public.stories enable row level security;
revoke all on public.stories from anon, authenticated;
grant all on public.stories to service_role;
create table public.sources (
  id uuid primary key,
  story_id uuid not null references stories(id),
  url text not null,
  canonical_url text not null,
  tier text not null check(tier in ('primary','journalism','discovery')),
  publisher text not null,
  author text not null,
  published_at timestamptz,
  retrieved_at timestamptz not null,
  type text not null,
  title text not null,
  excerpt text not null,
  is_primary boolean not null default false,
  reliability text not null);
create index sources_story_idx on public.sources(story_id);
alter table public.sources add constraint sources_story_identity unique(id, story_id);
alter table public.sources enable row level security;
revoke all on public.sources from anon, authenticated;
grant all on public.sources to service_role;
create table public.claims (
  id uuid primary key,
  story_id uuid not null references stories(id),
  text text not null,
  confidence text not null,
  verification_status text not null check(verification_status in ('unverified','supported','conflicting')),
  notes text not null);
create index claims_story_idx on public.claims(story_id);
alter table public.claims add constraint claims_story_identity unique(id, story_id);
alter table public.claims enable row level security;
revoke all on public.claims from anon, authenticated;
grant all on public.claims to service_role;
create table public.evidence (
  id uuid primary key,
  story_id uuid not null references stories(id),
  claim_id uuid not null,
  source_id uuid not null,
  excerpt text not null,
  locator text not null);
create index evidence_story_idx on public.evidence(story_id);
alter table public.evidence add constraint evidence_story_identity unique(id, story_id);
alter table public.evidence enable row level security;
revoke all on public.evidence from anon, authenticated;
grant all on public.evidence to service_role;
create table public.angles (
  id uuid primary key,
  story_id uuid not null references stories(id),
  text text not null,
  rationale text not null,
  kind text not null,
  created_by text not null check(created_by in ('human','ai')),
  approval_state text not null check(approval_state in ('suggested','approved','rejected')),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null,
  provenance text not null);
create index angles_story_idx on public.angles(story_id);
alter table public.angles add constraint angles_story_identity unique(id, story_id);
alter table public.angles enable row level security;
revoke all on public.angles from anon, authenticated;
grant all on public.angles to service_role;
create table public.drafts (
  id uuid primary key,
  story_id uuid not null references stories(id),
  platform text not null,
  format text not null,
  language text not null,
  hook text not null,
  body text not null,
  cta text not null,
  target_duration integer,
  revision integer not null check(revision > 0),
  status text not null check(status in ('draft','approved','changes_requested','rejected','superseded')),
  angle_id uuid not null,
  claim_ids uuid[] not null,
  asset_ids uuid[] not null,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null,
  provenance text not null,
  shot_notes text not null);
create index drafts_story_idx on public.drafts(story_id);
alter table public.drafts add constraint drafts_story_identity unique(id, story_id);
alter table public.drafts enable row level security;
revoke all on public.drafts from anon, authenticated;
grant all on public.drafts to service_role;
create table public.assets (
  id uuid primary key,
  story_id uuid not null references stories(id),
  draft_id uuid,
  type text not null,
  title text not null,
  source_url text not null,
  storage_url text,
  publisher text not null,
  retrieved_at timestamptz not null,
  usage_basis text not null,
  attribution text not null,
  rights_status text not null default 'unknown' check(rights_status in ('unknown','cleared','blocked')),
  publishable boolean not null default false,
  notes text not null,
  cleared_by text,
  cleared_at timestamptz);
create index assets_story_idx on public.assets(story_id);
alter table public.assets add constraint assets_story_identity unique(id, story_id);
alter table public.assets enable row level security;
revoke all on public.assets from anon, authenticated;
grant all on public.assets to service_role;
create table public.events (
  id uuid primary key,
  story_id uuid not null references stories(id),
  type text not null,
  actor text not null,
  from_status text,
  to_status text,
  draft_id uuid,
  detail text not null,
  created_at timestamptz not null);
create index events_story_idx on public.events(story_id);
alter table public.events add constraint events_story_identity unique(id, story_id);
alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
grant all on public.events to service_role;
create table public.publications (
  id uuid primary key,
  story_id uuid not null references stories(id),
  draft_id uuid not null,
  platform text not null,
  destination text not null,
  scheduled_at timestamptz,
  status text not null check(status in ('ready_to_schedule','scheduled_internal','integration_required','published_manual','cancelled')),
  published_url text,
  created_at timestamptz not null);
create index publications_story_idx on public.publications(story_id);
alter table public.publications add constraint publications_story_identity unique(id, story_id);
alter table public.publications enable row level security;
revoke all on public.publications from anon, authenticated;
grant all on public.publications to service_role;

alter table public.evidence add foreign key(claim_id, story_id) references public.claims(id, story_id);
alter table public.evidence add foreign key(source_id, story_id) references public.sources(id, story_id);
alter table public.drafts add foreign key(angle_id, story_id) references public.angles(id, story_id);
alter table public.publications add foreign key(draft_id, story_id) references public.drafts(id, story_id);
alter table public.drafts add unique(story_id, platform, revision);
alter table public.assets add check(not publishable or (rights_status = 'cleared' and length(trim(usage_basis)) > 0 and cleared_by is not null and cleared_at is not null));
alter table public.drafts add check(status <> 'approved' or (approved_by is not null and approved_at is not null));
alter table public.angles add check(approval_state <> 'approved' or (approved_by is not null and approved_at is not null));
alter table public.publications add check(status <> 'scheduled_internal' or scheduled_at is not null);
create index stories_status_idx on public.stories(status) where not archived;

create function public.protect_draft_content() returns trigger language plpgsql set search_path = public as $$
begin
 if (to_jsonb(new) - array['status','approved_by','approved_at']) is distinct from (to_jsonb(old) - array['status','approved_by','approved_at']) then
  raise exception 'Draft content is immutable; create a new revision';
 end if;
 if old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
  raise exception 'Approval history is immutable';
 end if;
 return new;
end $$;
create trigger immutable_draft before update on public.drafts for each row execute function public.protect_draft_content();

create function public.protect_event() returns trigger language plpgsql as $$
begin raise exception 'History events are append-only'; end $$;
create trigger immutable_event before update or delete on public.events for each row execute function public.protect_event();

create function public.read_newsroom() returns jsonb language sql stable security invoker set search_path = public as $$
 select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
'sources',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.sources c where c.story_id=s.id),'[]'::jsonb),
'claims',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.claims c where c.story_id=s.id),'[]'::jsonb),
'evidence',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.evidence c where c.story_id=s.id),'[]'::jsonb),
'angles',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.angles c where c.story_id=s.id),'[]'::jsonb),
'drafts',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.drafts c where c.story_id=s.id),'[]'::jsonb),
'assets',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.assets c where c.story_id=s.id),'[]'::jsonb),
'events',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.events c where c.story_id=s.id),'[]'::jsonb),
'publications',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.publications c where c.story_id=s.id),'[]'::jsonb)
) order by s.created_at desc),'[]'::jsonb) from public.stories s;
$$;

create function public.save_story(p_story jsonb, p_expected_version integer) returns void
language plpgsql security invoker set search_path = public as $$
declare existing_version integer; sid uuid := (p_story->>'id')::uuid; d public.drafts; aid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(sid::text,0));
 select version into existing_version from public.stories where id=sid for update;
 if existing_version is null then
  if p_expected_version <> -1 then raise exception 'Conflict: story missing'; end if;
 else
  if existing_version <> p_expected_version or (p_story->>'version')::integer <> existing_version+1 then
   raise exception 'Conflict: this story changed. Refresh and try again.';
  end if;
 end if;
 insert into public.stories select * from jsonb_populate_record(null::public.stories,p_story) on conflict(id) do update set title=excluded.title, summary=excluded.summary, status=excluded.status, pillar=excluded.pillar, story_type=excluded.story_type, primary_language=excluded.primary_language, discovered_at=excluded.discovered_at, published_at=excluded.published_at, urgency=excluded.urgency, confidence=excluded.confidence, audience_relevance=excluded.audience_relevance, latam_relevance=excluded.latam_relevance, commercial_relevance=excluded.commercial_relevance, why_matters=excluded.why_matters, latam_reason=excluded.latam_reason, research_notes=excluded.research_notes, research_confirmed=excluded.research_confirmed, priority=excluded.priority, archived=excluded.archived, is_demo=excluded.is_demo, active_draft_id=excluded.active_draft_id, production_completed=excluded.production_completed, production_checklist=excluded.production_checklist, created_at=excluded.created_at, updated_at=excluded.updated_at, version=excluded.version;
 if exists(select 1 from jsonb_populate_recordset(null::public.sources,p_story->'sources') x where x.story_id <> sid) then raise exception 'Cross-story record rejected'; end if;
 insert into public.sources select * from jsonb_populate_recordset(null::public.sources,p_story->'sources') on conflict(id) do update set story_id=excluded.story_id, url=excluded.url, canonical_url=excluded.canonical_url, tier=excluded.tier, publisher=excluded.publisher, author=excluded.author, published_at=excluded.published_at, retrieved_at=excluded.retrieved_at, type=excluded.type, title=excluded.title, excerpt=excluded.excerpt, is_primary=excluded.is_primary, reliability=excluded.reliability;
 if exists(select 1 from jsonb_populate_recordset(null::public.claims,p_story->'claims') x where x.story_id <> sid) then raise exception 'Cross-story record rejected'; end if;
 insert into public.claims select * from jsonb_populate_recordset(null::public.claims,p_story->'claims') on conflict(id) do update set story_id=excluded.story_id, text=excluded.text, confidence=excluded.confidence, verification_status=excluded.verification_status, notes=excluded.notes;
 if exists(select 1 from jsonb_populate_recordset(null::public.evidence,p_story->'evidence') x where x.story_id <> sid) then raise exception 'Cross-story record rejected'; end if;
 insert into public.evidence select * from jsonb_populate_recordset(null::public.evidence,p_story->'evidence') on conflict(id) do update set story_id=excluded.story_id, claim_id=excluded.claim_id, source_id=excluded.source_id, excerpt=excluded.excerpt, locator=excluded.locator;
 if exists(select 1 from jsonb_populate_recordset(null::public.angles,p_story->'angles') x where x.story_id <> sid) then raise exception 'Cross-story record rejected'; end if;
 insert into public.angles select * from jsonb_populate_recordset(null::public.angles,p_story->'angles') on conflict(id) do update set story_id=excluded.story_id, text=excluded.text, rationale=excluded.rationale, kind=excluded.kind, created_by=excluded.created_by, approval_state=excluded.approval_state, approved_by=excluded.approved_by, approved_at=excluded.approved_at, created_at=excluded.created_at, provenance=excluded.provenance;
 if exists(select 1 from jsonb_populate_recordset(null::public.drafts,p_story->'drafts') x where x.story_id <> sid) then raise exception 'Cross-story record rejected'; end if;
 insert into public.drafts select * from jsonb_populate_recordset(null::public.drafts,p_story->'drafts') on conflict(id) do update set story_id=excluded.story_id, platform=excluded.platform, format=excluded.format, language=excluded.language, hook=excluded.hook, body=excluded.body, cta=excluded.cta, target_duration=excluded.target_duration, revision=excluded.revision, status=excluded.status, angle_id=excluded.angle_id, claim_ids=excluded.claim_ids, asset_ids=excluded.asset_ids, approved_by=excluded.approved_by, approved_at=excluded.approved_at, created_at=excluded.created_at, provenance=excluded.provenance, shot_notes=excluded.shot_notes;
 if exists(select 1 from jsonb_populate_recordset(null::public.assets,p_story->'assets') x where x.story_id <> sid) then raise exception 'Cross-story record rejected'; end if;
 insert into public.assets select * from jsonb_populate_recordset(null::public.assets,p_story->'assets') on conflict(id) do update set story_id=excluded.story_id, draft_id=excluded.draft_id, type=excluded.type, title=excluded.title, source_url=excluded.source_url, storage_url=excluded.storage_url, publisher=excluded.publisher, retrieved_at=excluded.retrieved_at, usage_basis=excluded.usage_basis, attribution=excluded.attribution, rights_status=excluded.rights_status, publishable=excluded.publishable, notes=excluded.notes, cleared_by=excluded.cleared_by, cleared_at=excluded.cleared_at;
 if exists(select 1 from jsonb_populate_recordset(null::public.events,p_story->'events') x where x.story_id <> sid) then raise exception 'Cross-story record rejected'; end if;
 insert into public.events select * from jsonb_populate_recordset(null::public.events,p_story->'events') on conflict(id) do nothing;
 if exists(select 1 from jsonb_populate_recordset(null::public.publications,p_story->'publications') x where x.story_id <> sid) then raise exception 'Cross-story record rejected'; end if;
 insert into public.publications select * from jsonb_populate_recordset(null::public.publications,p_story->'publications') on conflict(id) do update set story_id=excluded.story_id, draft_id=excluded.draft_id, platform=excluded.platform, destination=excluded.destination, scheduled_at=excluded.scheduled_at, status=excluded.status, published_url=excluded.published_url, created_at=excluded.created_at;

 -- Validate the exact active revision whenever a package is approved/scheduled.
 if p_story->>'status' in ('approved','scheduled','published') then
  select * into d from public.drafts where id=(p_story->>'active_draft_id')::uuid and story_id=sid;
  if d.id is null or d.status <> 'approved' or d.approved_at is null or d.approved_by is null then raise exception 'Exact approved revision required'; end if;
  if exists(select 1 from public.drafts where story_id=sid and platform=d.platform and revision>d.revision) then raise exception 'Approval is stale'; end if;
  foreach aid in array d.asset_ids loop
   if not exists(select 1 from public.assets where id=aid and story_id=sid and publishable and rights_status='cleared' and cleared_by is not null) then raise exception 'Asset clearance required'; end if;
  end loop;
 end if;
 if exists(select 1 from public.publications p join public.drafts x on x.id=p.draft_id where p.story_id=sid and p.status in ('ready_to_schedule','scheduled_internal','published_manual') and (x.status <> 'approved' or x.id is distinct from (p_story->>'active_draft_id')::uuid)) then raise exception 'Only the current approved revision can enter publishing'; end if;
end $$;
revoke all on function public.save_story(jsonb,integer), public.read_newsroom(), public.protect_draft_content(), public.protect_event() from public, anon, authenticated;
grant execute on function public.save_story(jsonb,integer), public.read_newsroom() to service_role;
