-- One exact NEO owner-risk release. Rights remain UNCLEAR. Existing resolvers are unchanged.
alter function public.resolve_media_delivery(uuid,text) rename to resolve_pre_neo_media_delivery;
create function public.resolve_media_delivery(p_id uuid,p_hash text) returns jsonb
language sql stable security invoker set search_path=public as $$
 select coalesce(resolve_pre_neo_media_delivery(p_id,p_hash), (
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
 and p.data->'imported'->'publication'->>'kind'='neo-owner-risk-carousel/v1'
 and p.data->'imported'->'publication'->>'platform'='instagram'
 and (p.data->'imported'->'publication'->>'fresh_until')::timestamptz>now()
 and p.data->'imported'->'manifests'->'rights'->>'rights_clearance'='UNCLEAR'
 and jsonb_array_length(p.data->'imported'->'media')=4
 and jsonb_array_length(o.payload->'imported_refs')=4
 and jsonb_array_length(p.data->'imported'->'manifests'->'rights'->'assets')>0
 and not exists(select 1 from jsonb_array_elements(p.data->'imported'->'manifests'->'rights'->'assets') x
   where x->>'status' is distinct from 'UNCLEAR' or coalesce(x->>'basis','')='')

 and p.id='2d3607ca-cbfe-40a5-8b8a-99c48f204217' and c.id='ea03899d-5e4e-4d8a-8d06-98ce263927f2'
 and p.story_id='ce676caa-137e-442d-b68a-d6d796581b92'
 and a.id='3559b5ce-df46-414b-97e6-6892bf80ca8d' and a.data->>'external_id'='6ac0f19eea19ca0bde6332c1'
 and p.data->'imported'->>'revision'='NEO-OWNER-RISK-1'
 and p.data->'imported'->>'caption_sha256'='460f7b981123bd1c915b30aaa03143c12d4933031677a41f5f77420c6b5db208'
 and encode(sha256(convert_to(p.data->>'caption','UTF8')),'hex')='460f7b981123bd1c915b30aaa03143c12d4933031677a41f5f77420c6b5db208'
 and (r.data->'frozen'->>'due_at') is null
 and r.data->'decision'->>'actor'='4bf51631-dfff-4520-9f9b-6db774defaa9'
 and r.data->'decision'->>'neo_risk_acknowledgment'='neo-486de405-owner-risk/v1'
 and r.data->'decision'->'risk_acknowledgment'->>'policy_id'='neo-486de405-owner-risk/v1'
 and r.data->'decision'->'risk_acknowledgment'->>'owner_id'=r.data->'decision'->>'actor'
 and r.data->'decision'->'risk_acknowledgment'->>'at'=r.data->'decision'->>'at'
 and (r.data->'decision'->>'at')::timestamptz<=now()
 and r.data->'decision'->'risk_acknowledgment'->>'candidate_id'=r.id::text
 and r.data->'decision'->'risk_acknowledgment'->>'candidate_checksum'=r.data->>'checksum'
 and r.data->'decision'->'risk_acknowledgment'->>'rights_status'='UNCLEAR'
 and r.data->'decision'->'risk_acknowledgment'->>'caption_sha256'=p.data->'imported'->>'caption_sha256'
 and r.data->'decision'->'risk_acknowledgment'->>'disclosure'=p.data->'imported'->'manifests'->'rights'->>'disclosure'
 and r.data->'decision'->'risk_acknowledgment'->>'statement'=p.data->'imported'->'manifests'->'rights'->>'acknowledgment'
 and length(r.data->'decision'->'risk_acknowledgment'->>'statement')>100
 and r.data->'decision'->'risk_acknowledgment'->'ordered_media_sha256'='["8156c53c68a5d91dfa4ad4fc3dcdf56a1949f95fce457ea2754f8561d3e5af40","014e12434ef1d2e299620a7c95ad51072b408124616307d8991d7d2197fbd070","f2ef40fe4bd18e3c63fcdfc8ad620e875a5a7f89432ba9d38d2a1a84c4990eff","b789edb9195a564a0afd5a983c8637d752b96c5459360cdd56caf75a0a72a29c"]'::jsonb
 and r.data->'decision'->'risk_acknowledgment'->'ordered_media_sha256'=(select jsonb_agg(x.value->'sha256' order by x.ordinality) from jsonb_array_elements(o.payload->'imported_refs') with ordinality x(value,ordinality))
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
   and d.mime='image/png' and (x.value->>'width')::integer=1080 and (x.value->>'height')::integer=1350)
 ));
$$;
revoke all on function public.resolve_media_delivery(uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_media_delivery(uuid,text) to service_role;
