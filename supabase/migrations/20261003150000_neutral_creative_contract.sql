-- Additive, inert creative records/jobs. No table, RLS, auth or existing worker changes.
alter table public.control_entities drop constraint control_entities_kind_check;
alter table public.control_entities add constraint control_entities_kind_check check(kind in ('brand','idea','content','take','account','package','campaign','newsletter','experiment','review','graphic','quality','decision','question','link','notification','publication','profile','handle','outbox','opportunity','launch_plan','creative'));
alter table public.control_jobs drop constraint control_jobs_kind_check;
alter table public.control_jobs add constraint control_jobs_kind_check check(kind in ('distribution','analytics','graphic','export','creative'));

create function public.guard_creative_binding() returns trigger language plpgsql security invoker set search_path=public as $$
declare b jsonb; c control_entities; begin
 if new.kind<>'creative' then return new; end if;
 b:=new.data->'package'->'binding';
 if coalesce(new.data->'package'->>'schema_version','')<>'1' or coalesce(new.data->'package'->>'grammar_status','')<>'PENDING_C2_CREATIVE_VALIDATION'
    or coalesce(new.data->>'status','') not in ('draft','approved','invalidated') or b is null then raise exception 'Versioned neutral creative contract required'; end if;
 select * into c from control_entities where id=(b->>'content_id')::uuid and kind='content';
 if c.id is null or c.is_demo<>new.is_demo or new.parent_id is distinct from c.id or new.story_id is distinct from c.story_id or new.draft_id is distinct from c.draft_id
    or new.story_id is distinct from (b->>'story_id')::uuid or new.draft_id is distinct from (b->>'draft_id')::uuid then raise exception 'Creative content/story/draft mismatch'; end if;
 if new.data->>'status'<>'invalidated' and (
   c.version is distinct from (b->>'content_version')::int or c.data->>'draft_revision' is distinct from b->>'draft_revision' or
   not exists(select 1 from drafts d join stories s on s.id=d.story_id join angles a on a.id=d.angle_id
     where d.id=new.draft_id and s.id=new.story_id and d.revision=(b->>'draft_revision')::int
       and d.status='approved' and d.approved_by is not null and d.approved_at is not null and s.research_confirmed
       and s.active_draft_id=d.id and a.approval_state='approved' and a.id=(b->>'angle_id')::uuid)
 ) then raise exception 'Current approved creative revision binding required'; end if;
 if tg_op='UPDATE' and old.data->>'status'='approved' and new.data->>'status'='approved' and new.data is distinct from old.data
 then raise exception 'Approved creative specification is immutable; create a draft revision'; end if;
 if new.data->>'status'='approved' and (coalesce(new.data->'approval'->>'actor','')='' or coalesce(new.data->'approval'->>'fingerprint','') !~ '^[a-f0-9]{64}$')
 then raise exception 'Exact human creative approval required'; end if;
 return new;
end $$;
create trigger creative_binding_guard before insert or update on public.control_entities for each row execute function public.guard_creative_binding();
revoke all on function public.guard_creative_binding() from public,anon,authenticated;
grant execute on function public.guard_creative_binding() to service_role;
create function public.read_creative_media(p_id uuid) returns jsonb language sql stable security invoker set search_path=public as $$
 select to_jsonb(m) from media_objects m where id=p_id;
$$;
revoke all on function public.read_creative_media(uuid) from public,anon,authenticated;
grant execute on function public.read_creative_media(uuid) to service_role;
