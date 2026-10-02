-- Revision invalidation is durable, even when a story is edited outside the new workbench.
create function public.invalidate_control_story(p_story uuid,p_reason text) returns void language plpgsql security invoker set search_path=public as $$
declare epoch bigint; item control_entities; root_ids uuid[]; begin
 select array_agg(id) into root_ids from control_entities where kind='content' and story_id=p_story;
 if root_ids is null then return; end if;
 select version+1 into epoch from control_epoch where id=true for update;
 update control_epoch set version=epoch where id=true;
 for item in select * from control_entities where id=any(root_ids) or parent_id=any(root_ids) and kind in ('package','graphic') for update loop
  if item.kind='content' then
   item.data:=item.data||jsonb_build_object('content_state','drafting','status','draft','distribution_state','not_ready','final_approval',null,'revalidation_required',true,'stale_reason',p_reason);
  elsif item.kind='package' then item.data:=item.data||jsonb_build_object('status','invalidated','invalid_reason',p_reason);
  else item.data:=item.data||jsonb_build_object('status','stale','publishable',false,'invalid_reason',p_reason); end if;
  item.version:=item.version+1;
  update control_entities set data=item.data,version=item.version,updated_at=now() where id=item.id;
  insert into control_events(entity_id,kind,actor,epoch,snapshot) values(item.id,'revision_invalidated','revision-guard',epoch,to_jsonb(item));
 end loop;
 update public_surface set visible=false where source_id=any(root_ids);
 update control_jobs set status='cancelled',error=p_reason,lease_token=null,leased_until=null,updated_at=now()
 where entity_id in(select id from control_entities where id=any(root_ids) or parent_id=any(root_ids)) and status in ('queued','blocked','running');
end $$;
create function public.control_story_revision_changed() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if new.active_draft_id is distinct from old.active_draft_id or old.research_confirmed and not new.research_confirmed then
 perform invalidate_control_story(new.id,'Story research or exact active draft revision changed');
 end if; return new;
end $$;
create function public.control_draft_approval_changed() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if old.status='approved' and new.status is distinct from old.status then perform invalidate_control_story(new.story_id,'Approved script was superseded or revoked'); end if; return new;
end $$;
create function public.control_angle_approval_changed() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if old.approval_state='approved' and new.approval_state is distinct from old.approval_state then perform invalidate_control_story(new.story_id,'Approved angle was revoked'); end if; return new;
end $$;
create trigger control_story_revision_changed after update on public.stories for each row execute function public.control_story_revision_changed();
create trigger control_draft_approval_changed after update on public.drafts for each row execute function public.control_draft_approval_changed();
create trigger control_angle_approval_changed after update on public.angles for each row execute function public.control_angle_approval_changed();
revoke all on function public.invalidate_control_story(uuid,text),public.control_story_revision_changed(),public.control_draft_approval_changed(),public.control_angle_approval_changed() from public,anon,authenticated;
grant execute on function public.invalidate_control_story(uuid,text),public.control_story_revision_changed(),public.control_draft_approval_changed(),public.control_angle_approval_changed() to service_role;
