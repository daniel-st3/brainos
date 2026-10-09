-- Add a guarded single-Reel branch; existing standard and licensed-image branches are unchanged.
alter function public.resolve_media_delivery(uuid,text) rename to resolve_pre_reel_media_delivery;
create function public.resolve_media_delivery(p_id uuid,p_hash text) returns jsonb
language sql stable security invoker set search_path=public as $$
 select coalesce(resolve_pre_reel_media_delivery(p_id,p_hash), (
 select jsonb_build_object('bucket',d.bucket,'file_id',d.file_id,'mime',d.mime,'bytes',d.bytes,'sha256',d.sha256)
 from provider_media_deliveries d
 join provider_outbox o on o.id=d.outbox_id
 join control_entities p on p.id=o.package_id and p.kind='package' and p.version=o.package_version
 join control_entities c on c.id=p.parent_id and c.kind='content'
 join control_entities a on a.id=o.account_id and a.kind='account'
 join control_entities r on r.id::text=o.payload->'candidate_authorization'->>'id' and r.kind='review'
 where d.id=p_id and d.secret_hash=p_hash and d.revoked_at is null and d.graphic_id is null
 and d.guard_hash=media_delivery_guard(o.id)
 and o.status not in ('cancelled','blocked','dead_letter','resolved')
 and o.provider='instagram' and p.data->>'platform'='instagram' and a.data->>'platform'='instagram'
 and o.is_demo=p.is_demo and o.is_demo=c.is_demo and o.is_demo=a.is_demo and o.is_demo=r.is_demo
 and (o.payload->>'adapter_id'='buffer' or (o.is_demo and o.payload->>'adapter_id'='simulator'))
 and a.data->>'status'='connected' and a.data->'capabilities' ? 'publish'
 and a.data->>'external_id'=o.payload->>'account_external_id'
 and p.data->'imported'->'publication'->>'kind'='documented-instagram-reel/v1'
 and p.data->'imported'->'publication'->>'platform'='instagram'
 and (p.data->'imported'->'publication'->>'fresh_until')::timestamptz>now()
 and p.data->'imported'->'manifests'->'rights'->>'rights_clearance'='DOCUMENTED_BASIS_REQUIRES_FINAL_APPROVAL'
 and jsonb_array_length(p.data->'imported'->'media')=1
 and jsonb_array_length(o.payload->'imported_refs')=1
 and (o.payload->'imported_refs'->0->>'thumbnail_offset_ms')::integer=(p.data->'imported'->'publication'->>'thumbnail_offset_ms')::integer
 and jsonb_array_length(p.data->'imported'->'manifests'->'rights'->'assets')>0
 and not exists(select 1 from jsonb_array_elements(p.data->'imported'->'manifests'->'rights'->'assets') x
   where x->>'status' is distinct from 'BASIS_DOCUMENTED' or coalesce(x->>'basis','')='')
 and r.data->>'type'='cloud_approval_v1' and r.data->>'state' in ('APPROVED','QUEUED')
 and r.data->'decision'->>'decision'='approve' and coalesce(r.data->'decision'->>'actor','')<>''
 and r.data->>'checksum'=o.payload->'candidate_authorization'->>'checksum'
 and r.data->'frozen'->'imported'=p.data->'imported'
 and r.data->'frozen'->'media'=p.data->'imported'->'media'
 and r.data->'frozen'->>'package_id'=p.id::text and r.data->'frozen'->>'package_version'=p.version::text
 and r.data->'frozen'->>'content_id'=c.id::text and r.data->'frozen'->>'story_id'=p.story_id::text
 and r.data->'frozen'->>'account_id'=a.id::text and r.data->'frozen'->>'account_external_id'=a.data->>'external_id'
 and r.data->'frozen'->>'caption'=p.data->>'caption' and r.data->'frozen'->>'caption'=o.payload->>'caption'
 and c.data->'final_approval'->>'candidate_id'=r.id::text
 and c.data->'final_approval'->>'candidate_checksum'=r.data->>'checksum'
 and c.data->'final_approval'->>'package_id'=p.id::text
 and c.data->'final_approval'->>'package_version'=p.version::text
 and c.data->'final_approval'->>'fingerprint'=o.payload->>'content_fingerprint'
 and p.data->>'fingerprint'=o.payload->>'content_fingerprint'
 and (select jsonb_agg(jsonb_build_object('name',x.value->'name','file_id',x.value->'file_id','mime',x.value->'mime','bytes',x.value->'bytes','sha256',x.value->'sha256') order by x.ordinality)
   from jsonb_array_elements(o.payload->'imported_refs') with ordinality x(value,ordinality))=r.data->'frozen'->'media'
 and exists(select 1 from jsonb_array_elements(o.payload->'imported_refs') with ordinality x(value,ordinality)
   where d.asset_key='imported:'||(x.ordinality-1)::text and x.value->>'file_id'=d.file_id
   and x.value->>'sha256'=d.sha256 and x.value->>'mime'=d.mime and (x.value->>'bytes')::bigint=d.bytes
   and d.mime='video/mp4' and (x.value->>'duration')::numeric between 5 and 900 and x.value->>'codec'='h264'
   and (x.value->>'thumbnail_offset_ms')::integer>=0 and (x.value->>'thumbnail_offset_ms')::numeric<(x.value->>'duration')::numeric*1000)
 ));
$$;
revoke all on function public.resolve_media_delivery(uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_media_delivery(uuid,text) to service_role;
