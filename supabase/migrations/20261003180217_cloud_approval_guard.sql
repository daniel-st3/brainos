-- Reuse private control records and append-only events. No public grants or new tables.
create function public.guard_cloud_approval() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if tg_op='UPDATE' and old.kind='review' and old.data->>'type'='cloud_approval_v1' then
  if new.kind is distinct from old.kind or new.is_demo is distinct from old.is_demo
    or new.parent_id is distinct from old.parent_id or new.story_id is distinct from old.story_id or new.draft_id is distinct from old.draft_id
    or new.data->>'type' is distinct from old.data->>'type'
    or new.data->'frozen' is distinct from old.data->'frozen' or new.data->'checksum' is distinct from old.data->'checksum'
    or new.data->'created_at' is distinct from old.data->'created_at' or new.data->'expires_at' is distinct from old.data->'expires_at'
  then raise exception 'Immutable publication candidate; create a new revision'; end if;
  if old.data->'decision' <> 'null'::jsonb and new.data->'decision' is distinct from old.data->'decision' then raise exception 'Decision is immutable'; end if;
  if old.data->>'state' <> new.data->>'state' and not (
    (old.data->>'state'='AWAITING_DANIEL' and new.data->>'state' in ('APPROVED','REQUEST_CHANGES','REJECTED','STALE','EXPIRED')) or
    (old.data->>'state'='APPROVED' and new.data->>'state'='QUEUED')
  ) then raise exception 'Invalid approval transition'; end if;
 end if;
 if new.kind='review' and new.data->>'type'='cloud_approval_v1' then
  if coalesce(new.data->>'checksum','') !~ '^[a-f0-9]{64}$' or new.data->'frozen' is null then raise exception 'Exact candidate required'; end if;
  if new.data->>'state' in ('APPROVED','QUEUED') and (coalesce(new.data->'decision'->>'decision','')<>'approve' or coalesce(new.data->'decision'->>'actor','')='') then raise exception 'Human approval required'; end if;
 end if;
 return new;
end $$;
create trigger cloud_approval_guard before insert or update on public.control_entities for each row execute function public.guard_cloud_approval();
revoke all on function public.guard_cloud_approval() from public,anon,authenticated;
grant execute on function public.guard_cloud_approval() to service_role;
create unique index cloud_candidate_checksum on public.control_entities ((data->>'checksum'),is_demo) where kind='review' and data->>'type'='cloud_approval_v1';
