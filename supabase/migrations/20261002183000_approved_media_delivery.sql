-- Stable per-file capability URLs for approved provider media. No public bucket.
create table public.provider_media_deliveries (
 id uuid primary key,
 outbox_id uuid not null references public.provider_outbox(id),
 guard_hash text not null,
 secret_hash text not null check(secret_hash ~ '^[a-f0-9]{64}$'),
 asset_key text not null,
 bucket text not null check(bucket='brainos-production'),
 file_id text not null check(length(file_id)<1000 and position('..' in file_id)=0),
 mime text not null check(mime in ('video/mp4','image/png','image/jpeg')),
 bytes bigint not null check(bytes>0 and bytes<=50000000),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 graphic_id uuid references public.control_entities(id),
 graphic_version integer,
 revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create index delivery_outbox on public.provider_media_deliveries(outbox_id);
alter table public.provider_media_deliveries enable row level security;
revoke all on public.provider_media_deliveries from public,anon,authenticated;
grant all on public.provider_media_deliveries to service_role;

-- Freeze dependencies after the application has verified readiness. Every fetch
-- recomputes this guard; routine publication/analytics bookkeeping is excluded.
create function public.media_delivery_guard(p_outbox uuid) returns text language sql stable security invoker set search_path=public as $$
 select md5(jsonb_build_object(
  'package',to_jsonb(p),
  'content',c.data-'distribution_state'-'analytics_state',
  'brand',(select jsonb_agg(to_jsonb(b) order by b.id) from control_entities b where b.kind='brand' and b.is_demo=p.is_demo and b.data->>'status'='active'),
  'take',(select to_jsonb(t) from control_entities t where t.id::text=c.data->>'take_id'),
  'story',(select to_jsonb(s) from stories s where s.id=c.story_id),
  'drafts',(select jsonb_agg(to_jsonb(x) order by x.id) from drafts x where x.story_id=c.story_id),
  'angles',(select jsonb_agg(to_jsonb(x) order by x.id) from angles x where x.story_id=c.story_id),
  'assets',(select jsonb_agg(to_jsonb(x) order by x.id) from assets x where x.story_id=c.story_id),
  'claims',(select jsonb_agg(to_jsonb(x) order by x.id) from claims x where x.story_id=c.story_id),
  'sources',(select jsonb_agg(to_jsonb(x) order by x.id) from sources x where x.story_id=c.story_id),
  'evidence',(select jsonb_agg(to_jsonb(x) order by x.id) from evidence x where x.story_id=c.story_id),
  'production',(select to_jsonb(x) from production_packages x where x.id::text=c.data->>'production_id'),
  'graphics',(select jsonb_agg(to_jsonb(x) order by x.id) from control_entities x where x.kind='graphic' and p.data->'graphic_ids' ? x.id::text)
 )::text) from provider_outbox o join control_entities p on p.id=o.package_id join control_entities c on c.id=p.parent_id where o.id=p_outbox;
$$;

create function public.resolve_media_delivery(p_id uuid,p_hash text) returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('bucket',d.bucket,'file_id',d.file_id,'mime',d.mime,'bytes',d.bytes,'sha256',d.sha256)
 from provider_media_deliveries d
 join provider_outbox o on o.id=d.outbox_id
 join control_entities p on p.id=o.package_id and p.kind='package' and p.version=o.package_version
 join control_entities c on c.id=p.parent_id and c.kind='content'
 join control_entities a on a.id=o.account_id and a.kind='account'
 left join control_entities g on g.id=d.graphic_id
 where d.id=p_id and d.secret_hash=p_hash and d.revoked_at is null
 and d.guard_hash=media_delivery_guard(o.id)
 and o.status not in ('cancelled','blocked','dead_letter','resolved')
 and a.data->>'status'='connected'
 and a.data->'capabilities' ? 'publish'
 and c.data->>'content_state'='approved'
 and exists(select 1 from stories s join drafts dr on dr.story_id=s.id and dr.id=c.draft_id
   join angles an on an.id=dr.angle_id and an.story_id=s.id
   where s.id=c.story_id and s.research_confirmed and s.active_draft_id=dr.id
   and dr.status='approved' and dr.approved_at is not null and dr.approved_by is not null
   and dr.revision=(c.data->>'draft_revision')::integer
   and an.approval_state='approved'
   and (an.kind<>'opinion' or exists(select 1 from control_entities t where t.id::text=c.data->>'take_id' and t.data->>'status'='approved' and t.data->>'approved_by' is not null))
   and not exists(select 1 from unnest(dr.asset_ids) required_id where not exists(
     select 1 from assets x where x.id=required_id and x.story_id=s.id and x.publishable and x.rights_status='cleared' and length(x.usage_basis)>0 and x.cleared_by is not null)))
 and exists(select 1 from control_entities b where b.kind='brand' and b.is_demo=p.is_demo and b.data->>'status'='active' and b.id::text=p.data->>'brand_id' and b.version=(p.data->>'brand_version')::integer)
 and (c.data->>'format'<>'video' or exists(select 1 from production_packages pp
   where pp.id::text=c.data->>'production_id' and pp.draft_id=c.draft_id and pp.valid
   and pp.data->>'state'='approved' and pp.version=(pp.data->'approval'->>'production_version')::integer
   and pp.data->'approval'->>'output_sha256'=pp.data->'output'->>'sha256'
   and pp.data->'output'=o.payload->'media_ref'
   and not exists(select 1 from jsonb_array_elements(pp.data->'assets') pa where coalesce((pa->>'required')::boolean,false) and (pa->>'rights'<>'cleared' or not coalesce((pa->>'publishable')::boolean,false)))))
 and not exists(select 1 from jsonb_array_elements_text(p.data->'graphic_ids') gid where not exists(
   select 1 from control_entities gg where gg.id::text=gid and gg.kind='graphic' and gg.data->>'rights'='cleared' and coalesce((gg.data->>'publishable')::boolean,false)
   and gg.data->>'content_revision'=c.data->>'draft_revision'
   and c.data->>'platform'=any(string_to_array(gg.data->>'scope',','))))
 and p.data->>'fingerprint'=o.payload->>'content_fingerprint'
 and a.data->>'external_id'=o.payload->>'account_external_id'
 and p.data->>'status'='approved'
 and c.data->'final_approval'->>'package_id'=p.id::text
 and c.data->'final_approval'->>'package_version'=p.version::text
 and c.data->'final_approval'->>'fingerprint'=o.payload->>'content_fingerprint'
 and not coalesce((c.data->>'revalidation_required')::boolean,true)
 and (coalesce((c.data->>'evergreen')::boolean,false) or (c.data->>'fresh_until')::timestamptz>now())
 and (
  (d.graphic_id is null and o.payload->'media_ref'->>'provider'='supabase'
   and o.payload->'media_ref'->>'file_id'=d.file_id
   and o.payload->'media_ref'->>'sha256'=d.sha256
   and o.payload->'media_ref'->>'mime'=d.mime
   and (o.payload->'media_ref'->>'bytes')::bigint=d.bytes)
  or (d.graphic_id is not null and g.version=d.graphic_version
   and p.data->'graphic_ids' ? g.id::text
   and g.data->>'rights'='cleared' and coalesce((g.data->>'publishable')::boolean,false)
   and exists(select 1 from jsonb_array_elements(g.data->'outputs') output
     cross join lateral (values(output->'png'),(output->'jpeg')) raster(v)
     where raster.v->>'file_id'=d.file_id and raster.v->>'sha256'=d.sha256
     and raster.v->>'mime'=d.mime and (raster.v->>'bytes')::bigint=d.bytes
     and raster.v->>'source_svg_sha256'=output->>'sha256'))
 );
$$;
create function public.register_media_delivery(p_record jsonb) returns void language plpgsql security invoker set search_path=public as $$
declare d provider_media_deliveries; begin
 d:=jsonb_populate_record(null::provider_media_deliveries,p_record);
 insert into provider_media_deliveries(id,outbox_id,guard_hash,secret_hash,asset_key,bucket,file_id,mime,bytes,sha256,graphic_id,graphic_version)
 values(d.id,d.outbox_id,media_delivery_guard(d.outbox_id),d.secret_hash,d.asset_key,d.bucket,d.file_id,d.mime,d.bytes,d.sha256,d.graphic_id,d.graphic_version);
 if resolve_media_delivery(d.id,d.secret_hash) is null then raise exception 'Exact approved media delivery required'; end if;
end $$;
revoke all on function public.resolve_media_delivery(uuid,text),public.register_media_delivery(jsonb) from public,anon,authenticated;
grant execute on function public.resolve_media_delivery(uuid,text),public.register_media_delivery(jsonb) to service_role;

revoke all on function public.media_delivery_guard(uuid) from public,anon,authenticated;
grant execute on function public.media_delivery_guard(uuid) to service_role;
